from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.graph.client import GraphClient, get_graph_client

DbSession = Annotated[Session, Depends(get_db)]
Graph = Annotated[GraphClient, Depends(get_graph_client)]
Limit = Annotated[int, Query(ge=1, le=100, description="Page size (1–100)")]
Offset = Annotated[int, Query(ge=0, description="Items to skip")]
