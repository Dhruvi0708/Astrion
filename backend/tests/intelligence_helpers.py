"""Shared helpers for intelligence-engine tests: a seeded workspace and a fault-injecting LLM."""

import io
import threading
from collections.abc import Callable

from app.ai.llm import ProviderBadRequestError, ProviderUnavailableError
from app.intelligence.fixture import FixtureLLM

REEF_REPORT = """Coral Reef Survey 2023

Ocean warming increases coral bleaching across the northern reef. Surveys recorded bleaching at 61 percent of sites in 2023.
Marine heatwaves cause coral bleaching when temperatures stay above the seasonal maximum for several weeks.
Nutrient runoff correlates with algae growth on damaged reef sections near river mouths.
"""

REEF_REVIEW = """Independent Reef Review

Ocean warming does not increase coral bleaching at the southern sites, where cooler upwelling persisted through 2023.
Coral recovery depends on herbivorous fish populations that graze algae after bleaching events.
Marine heatwaves cause coral bleaching in shallow lagoons, according to the review team.
"""

QUESTION = "Does ocean warming increase coral bleaching on the reef?"


def seed_workspace(client, name: str = "Reef research") -> dict:
    ws = client.post("/api/v1/workspaces", json={"name": name}).json()
    src = client.post(f"/api/v1/workspaces/{ws['id']}/sources", json={"title": "Reef monitoring", "source_type": "report"}).json()
    docs = []
    for fname, body in (("survey.txt", REEF_REPORT), ("review.md", REEF_REVIEW)):
        r = client.post(f"/api/v1/sources/{src['id']}/documents/upload", files={"file": (fname, io.BytesIO(body.encode()), "text/plain")})
        assert r.status_code == 201, r.text
        docs.append(r.json())
    return {"ws": ws, "src": src, "docs": docs}


def create_investigation(client, ws_id: str, doc_ids: list[str] | None = None, question: str = QUESTION) -> dict:
    r = client.post(f"/api/v1/workspaces/{ws_id}/investigations", json={"title": "Warming and bleaching", "question": question, "document_ids": doc_ids or []})
    assert r.status_code == 201, r.text
    return r.json()


class ScriptedLLM(FixtureLLM):
    """The fixture provider plus programmable faults, so orchestration paths can be exercised.

    ``faults[agent]`` is a list of callables consumed one per call; each may raise, block or return
    ``None`` to let the fixture answer normally.
    """

    def __init__(self) -> None:
        super().__init__()
        self.faults: dict[str, list[Callable[[], None]]] = {}
        self.calls: list[str] = []
        self.concurrent = 0
        self.max_concurrent = 0
        self._lock = threading.Lock()
        self.barrier: threading.Barrier | None = None
        self.on_call: Callable[[str], None] | None = None

    def generate(self, *, agent, **kw):  # noqa: ANN001, ANN003, ANN201
        with self._lock:
            self.calls.append(agent)
            self.concurrent += 1
            self.max_concurrent = max(self.max_concurrent, self.concurrent)
            fault = self.faults.get(agent, []).pop(0) if self.faults.get(agent) else None
        try:
            if self.on_call:
                self.on_call(agent)
            if fault:
                fault()
            return super().generate(agent=agent, **kw)
        finally:
            with self._lock:
                self.concurrent -= 1


def unavailable() -> None:
    raise ProviderUnavailableError("overloaded", provider="fixture", status_code=529)


def bad_request() -> None:
    raise ProviderBadRequestError("invalid request", provider="fixture", status_code=400)
