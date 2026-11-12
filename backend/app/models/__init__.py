"""Importing this package registers every model on ``Base.metadata`` (used by Alembic)."""

from app.models.identity import AuthSession, User, Workspace
from app.models.knowledge import Claim, Evidence, GraphEntity, GraphRelationship, GraphSnapshot
from app.models.research import AgentExecution, Hypothesis, HypothesisEvidence, Investigation, SimulationScenario
from app.models.sources import Document, Source

__all__ = [
    "AgentExecution",
    "AuthSession",
    "Claim",
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
