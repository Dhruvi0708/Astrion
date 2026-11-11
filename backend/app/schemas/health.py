from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ServiceHealth(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    environment: str
    timestamp: datetime


class DependencyHealth(BaseModel):
    name: Literal["postgres", "neo4j"]
    status: Literal["ok", "unavailable", "not_configured"]
    latency_ms: float | None = None
    detail: str | None = None
