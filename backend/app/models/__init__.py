"""Importing this package registers every model on ``Base.metadata`` (used by Alembic)."""

from app.models.identity import AuthSession, User, Workspace
from app.models.intelligence import (
    AgentMessage,
    Contradiction,
    DocumentChunk,
    GraphChange,
    InvestigationReport,
    InvestigationRun,
    SourceAssessment,
    VerificationResult,
)
from app.models.knowledge import Claim, Evidence, GraphEntity, GraphRelationship, GraphSnapshot, InvestigationClaim, RelationshipClaim
from app.models.research import AgentExecution, Hypothesis, HypothesisEvidence, Investigation, SimulationScenario
from app.models.sources import Document, Source

__all__ = [
    "AgentExecution",
    "AgentMessage",
    "AuthSession",
    "Claim",
    "Contradiction",
    "DocumentChunk",
    "GraphChange",
    "InvestigationClaim",
    "InvestigationReport",
    "InvestigationRun",
    "SourceAssessment",
    "RelationshipClaim",
    "VerificationResult",
    "Document",
    "Evidence",
    "GraphEntity",
    "GraphRelationship",
    "GraphSnapshot",
    "Hypothesis",
    "HypothesisEvidence",
    "Investigation",
    "SimulationScenario",
    "Source",
    "User",
    "Workspace",
]
