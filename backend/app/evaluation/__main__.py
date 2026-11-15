"""CLI: python -m app.evaluation [--dataset reef_v1 grid_v1] [--provider fixture|anthropic] [--out DIR]

`fixture` (default) is deterministic and free: it measures the engine. `anthropic` uses
ANTHROPIC_API_KEY and ASTRION_LLM_MODEL, costs money, and is the only way to measure reasoning quality.
"""

import argparse
import json
import sys
from pathlib import Path

from app.core.config import Settings
from app.evaluation.runner import DATASETS, run_benchmark
from app.intelligence.fixture import FixtureLLM


def main() -> int:
    parser = argparse.ArgumentParser(description="Run ASTRION evaluation benchmarks.")
    parser.add_argument("--dataset", nargs="*", default=sorted(p.stem for p in DATASETS.glob("*.json")))
    parser.add_argument("--provider", choices=["fixture", "anthropic"], default="fixture")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "evaluation" / "results"))
    args = parser.parse_args()

    if args.provider == "fixture":
        llm = FixtureLLM()
    else:
        from app.intelligence.llm import ClaudeStructuredLLM

        settings = Settings()
        if not (settings.anthropic_api_key and settings.anthropic_api_key.get_secret_value()):
            print("ANTHROPIC_API_KEY is not set; refusing to run a 'real model' benchmark without a model.", file=sys.stderr)
            return 2
        llm = ClaudeStructuredLLM(settings)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name in args.dataset:
        report = run_benchmark(name, llm)
        path = out / f"{name}.{report['provider']}.json"
        path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        m = report["metrics"]
        print(
            f"[{report['label']}] {name}: coverage={m['evidence_coverage']['score']} support={m['claim_support']['score']} "
            f"contradiction_recall={m['contradiction_detection']['recall']} supersession={m['temporal']['supersession_recall']} "
            f"graph_consistent={m['graph_consistency']['consistent']} -> {path}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
