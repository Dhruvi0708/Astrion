"""Runs investigations in the background of the API process.

Deliberately simple: a bounded thread pool inside the backend (no broker, no extra services). State is
durable in PostgreSQL, so a restart loses nothing: runs that were in flight are marked ``interrupted``
at startup and can be resumed, skipping every step that had already succeeded.
"""

import logging
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.models import Investigation
from app.models.enums import InvestigationStatus

logger = logging.getLogger("astrion.runner")


class InvestigationRunner:
    def __init__(self, session_factory: sessionmaker[Session], settings: Settings, orchestrator_factory: Callable[[], object], inline: bool = False) -> None:
        self.sessions = session_factory
        self.settings = settings
        self.orchestrator_factory = orchestrator_factory
        self.inline = inline  # tests: run synchronously in the request
        self._active: set[uuid.UUID] = set()
        self._lock = threading.Lock()
        self._pool = None if inline else ThreadPoolExecutor(max_workers=settings.max_concurrent_investigations, thread_name_prefix="astrion-investigation")

    def submit(self, investigation_id: uuid.UUID) -> bool:
        """Schedules a queued investigation. Returns False if it is already running in this process."""
        with self._lock:
            if investigation_id in self._active:
                return False
            self._active.add(investigation_id)
        if self.inline:
            self._run(investigation_id)
        else:
            self._pool.submit(self._run, investigation_id)
        return True

    def _run(self, investigation_id: uuid.UUID) -> None:
        try:
            self.orchestrator_factory().run(investigation_id)
        except Exception:
            logger.exception("runner failure", extra={"investigation_id": str(investigation_id)})
        finally:
            with self._lock:
                self._active.discard(investigation_id)

    def is_active(self, investigation_id: uuid.UUID) -> bool:
        with self._lock:
            return investigation_id in self._active

    def recover(self) -> int:
        """Marks runs left in flight by a previous process as interrupted (or cancelled)."""
        db = self.sessions()
        try:
            cancelled = db.execute(
                update(Investigation)
                .where(Investigation.status == InvestigationStatus.cancelling)
                .values(status=InvestigationStatus.cancelled, cancel_requested=False)
            )
            interrupted = db.execute(
                update(Investigation)
                .where(Investigation.status.in_([InvestigationStatus.running, InvestigationStatus.queued]))
                .values(status=InvestigationStatus.interrupted)
            )
            db.commit()
            total = (cancelled.rowcount or 0) + (interrupted.rowcount or 0)
            if total:
                logger.warning("recovered stale investigations", extra={"count": total})
            return total
        finally:
            db.close()

    def shutdown(self) -> None:
        if self._pool:
            self._pool.shutdown(wait=False, cancel_futures=True)
