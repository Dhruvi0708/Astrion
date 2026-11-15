"""The evaluation harness: reproducible, honestly labelled, and scored against gold annotations.

MOCKED LLM: these runs use the fixture provider. They verify the harness and the engine's invariants
(verbatim evidence, graph consistency, determinism), not reasoning quality.
"""

import subprocess
import sys
from pathlib import Path

from app.evaluation.runner import DATASETS, load_dataset, run_benchmark
from app.intelligence.fixture import FixtureLLM

BACKEND = Path(__file__).resolve().parents[1]


def _stable(report: dict) -> dict:
    return {k: v for k, v in report.items() if k not in ("generated_at", "duration_s")}


def test_benchmark_is_reproducible_and_labelled_as_mocked():
    first = run_benchmark("reef_v1", FixtureLLM())
    second = run_benchmark("reef_v1", FixtureLLM())
    assert _stable(first) == _stable(second)  # same dataset + same provider → identical scores
    assert first["is_real_model"] is False and first["label"].startswith("MOCKED LLM")
    assert len(first["dataset"]["sha256"]) == 64
    m = first["metrics"]
    assert m["claim_support"]["score"] == 1.0  # every evidence quote is verbatim in its document
    assert m["graph_consistency"]["consistent"] is True
    assert m["entity_resolution"]["exact_duplicates"] == 0
    assert m["temporal"]["supersession_recall"] == 1.0
    assert all(q["status"] == "completed" for q in m["investigation_quality"])
    for role, stats in m["agent_reliability"].items():
        assert stats["executions"] >= 1, role


def test_every_dataset_has_gold_annotations():
    names = sorted(p.stem for p in DATASETS.glob("*.json"))
    assert names == ["grid_v1", "reef_v1"]
    for name in names:
        data, _ = load_dataset(name)
        gold = data["gold"]
        texts = " ".join(p for s in data["sources"] for d in s["documents"] for p in d["paragraphs"])
        for fact in gold["facts"]:
            assert fact["text"] in texts, (name, fact["id"])  # gold facts are real sentences of the corpus
        assert gold["entities"] and gold["contradictions"] and len(data["investigations"]) >= 2


def test_real_model_benchmark_refuses_to_run_without_a_key(tmp_path):
    proc = subprocess.run(
        [sys.executable, "-m", "app.evaluation", "--provider", "anthropic", "--dataset", "reef_v1", "--out", str(tmp_path)],
        cwd=BACKEND,
        env={
            "ANTHROPIC_API_KEY": "",
            "ASTRION_ENVIRONMENT": "test",
            "SYSTEMROOT": __import__("os").environ.get("SYSTEMROOT", ""),
            "PATH": __import__("os").environ.get("PATH", ""),
        },
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 2 and "ANTHROPIC_API_KEY is not set" in proc.stderr
    assert not list(tmp_path.iterdir())  # no report pretending to be a real-model result
