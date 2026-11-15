"""Benchmark runner: runs a dataset's investigations through the real orchestrator in an isolated
in-memory database and scores the results against the dataset's gold annotations.

The report always states which provider produced it. Fixture runs measure the *engine* (provenance,
persistence, control flow, determinism); only runs with a real model measure reasoning quality.
"""

import hashlib
import io
import json
import tempfile
import time
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (registers tables)
from app.core.config import Settings
from app.db.base import Base
from app.evaluation import metrics
from app.intelligence.llm import StructuredLLM
from app.intelligence.orchestrator import Orchestrator
from app.models import Document, Investigation, Source, User, Workspace
from app.models.enums import InvestigationStatus, SourceType
from app.storage import build_storage_key
from app.storage.local import LocalStorage

DATASETS = Path(__file__).resolve().parents[2] / "evaluation" / "datasets"


def load_dataset(name_or_path: str) -> tuple[dict, str]:
    path = Path(name_or_path)
    if not path.exists():
        path = DATASETS / f"{name_or_path}.json"
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def document_text(dataset: dict, doc: dict) -> str:
    pad = dataset.get("padding", "") * int(dataset.get("padding_repeats", 0))
    return "\n\n".join(p + ("\n" + pad if pad else "") for p in doc["paragraphs"])


def _seed(db: Session, storage: LocalStorage, dataset: dict) -> tuple[Workspace, dict[str, str]]:
    user = User(email=f"eval-{uuid.uuid4().hex[:8]}@example.org", password_hash="!", display_name="Evaluation")
    db.add(user)
    db.flush()
    ws = Workspace(name=f"Evaluation {dataset['name']}", slug=f"eval-{uuid.uuid4().hex[:8]}", owner_id=user.id)
    db.add(ws)
    db.flush()
    texts = {}
    for s in dataset["sources"]:
        src = Source(
            workspace_id=ws.id,
            title=s["title"],
            source_type=SourceType(s["source_type"]),
            authors=s.get("authors", []),
            uri=s.get("uri"),
            published_on=date.fromisoformat(s["published_on"]) if s.get("published_on") else None,
        )
        db.add(src)
        db.flush()
        for d in s["documents"]:
            body = document_text(dataset, d).encode()
            digest = hashlib.sha256(body).hexdigest()
            doc = Document(workspace_id=ws.id, source_id=src.id, title=d["title"], media_type="text/plain", byte_size=len(body), content_hash=digest)
            db.add(doc)
            db.flush()
            key = build_storage_key(ws.id, doc.id, digest, ".txt")
            storage.put(key, io.BytesIO(body), size=len(body), content_type="text/plain")
            doc.storage_key, doc.storage_backend = key, "local"
            texts[d["title"]] = body.decode()
    db.commit()
    return ws, texts


def run_benchmark(dataset_name: str, llm: StructuredLLM, settings: Settings | None = None, graph_repo=None) -> dict:  # noqa: ANN001
    dataset, digest = load_dataset(dataset_name)
    settings = settings or Settings(ASTRION_ENVIRONMENT="test", ASTRION_AGENT_RETRY_BACKOFF_SECONDS=0)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda c, _: c.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    started = time.perf_counter()
    with tempfile.TemporaryDirectory() as tmp:
        storage = LocalStorage(Path(tmp))
        db = sessions()
        ws, texts = _seed(db, storage, dataset)
        orchestrator = Orchestrator(sessions, llm, settings, storage=storage, graph_repo=graph_repo, sleep=lambda _: None)
        invs = []
        for spec in dataset["investigations"]:
            inv = Investigation(workspace_id=ws.id, title=spec["title"], question=spec["question"], status=InvestigationStatus.queued, run_count=1)
            db.add(inv)
            db.commit()
            orchestrator.run(inv.id)
            db.expire_all()
            invs.append(db.get(Investigation, inv.id))
        report = {
            "dataset": {"name": dataset["name"], "version": dataset["version"], "sha256": digest},
            "provider": llm.provider,
            "model": llm.model,
            "is_real_model": llm.provider != "fixture",
            "label": "MOCKED LLM (deterministic fixture): measures the engine, not reasoning quality"
            if llm.provider == "fixture"
            else f"REAL MODEL ({llm.model})",
            "settings": {k: getattr(settings, k) for k in ("max_iterations", "run_max_llm_calls", "research_initial_chars", "max_debated_hypotheses")},
            "generated_at": datetime.now(UTC).isoformat(),
            "duration_s": None,
            "metrics": metrics.compute(db, ws.id, invs, dataset, texts),
            "investigations": [{"title": i.title, "status": i.status.value, "error": i.error} for i in invs],
        }
        db.close()
    engine.dispose()
    report["duration_s"] = round(time.perf_counter() - started, 2)
    return report
