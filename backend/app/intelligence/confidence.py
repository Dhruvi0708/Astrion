"""Explicit, auditable confidence methodology for hypotheses.

Confidence is computed from the evidence, not taken from the model:

    weight(claim)   = 1.0 if explicit else 0.5
    support         = Σ weight(supporting claims)
    opposition      = Σ weight(opposing claims)
    balance         = support / (support + opposition + 1)            # +1 = prior of one unit of doubt
    diversity       = min(1, 0.5 + 0.25 × (distinct supporting sources − 1))
    evidence_score  = balance × diversity
    final           = evidence_score × verification_factor(verdict)

    verification_factor: supported 1.0 · partially_supported 0.75 · insufficient_evidence 0.5 ·
                         unsupported 0.25 · contradicted 0.1 · not yet verified 0.6
    band:  < 0.34 low · < 0.67 medium · otherwise high

The model's own "plausibility" is recorded for transparency but does not enter the score.
"""

from dataclasses import dataclass

VERIFICATION_FACTOR = {
    "supported": 1.0,
    "partially_supported": 0.75,
    "insufficient_evidence": 0.5,
    "unsupported": 0.25,
    "contradicted": 0.1,
    None: 0.6,
}


@dataclass(frozen=True)
class ClaimWeight:
    explicit: bool
    source_id: str


def band(score: float) -> str:
    return "low" if score < 0.34 else "medium" if score < 0.67 else "high"


def hypothesis_confidence(supporting: list[ClaimWeight], opposing: list[ClaimWeight], verdict: str | None = None, plausibility: str | None = None) -> dict:
    w = lambda c: 1.0 if c.explicit else 0.5  # noqa: E731
    support = sum(w(c) for c in supporting)
    opposition = sum(w(c) for c in opposing)
    balance = support / (support + opposition + 1)
    sources = len({c.source_id for c in supporting})
    diversity = min(1.0, 0.5 + 0.25 * max(0, sources - 1))
    evidence_score = balance * diversity
    factor = VERIFICATION_FACTOR.get(verdict, VERIFICATION_FACTOR[None])
    final = round(evidence_score * factor, 4)
    return {
        "method": "astrion-evidence-v1",
        "score": final,
        "band": band(final),
        "inputs": {
            "supporting_claims": len(supporting),
            "supporting_explicit": sum(1 for c in supporting if c.explicit),
            "opposing_claims": len(opposing),
            "distinct_supporting_sources": sources,
            "verification_verdict": verdict,
            "model_plausibility": plausibility,
        },
        "components": {
            "support": support,
            "opposition": opposition,
            "balance": round(balance, 4),
            "diversity": diversity,
            "evidence_score": round(evidence_score, 4),
            "verification_factor": factor,
        },
    }
