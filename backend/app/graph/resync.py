"""Rebuild the Neo4j projection from PostgreSQL (the system of record).

    python -m app.graph.resync              # every workspace
    python -m app.graph.resync <workspace>  # one workspace

Used for disaster recovery (restore PostgreSQL, then rebuild the graph) and after pointing ASTRION at a
fresh Neo4j. Idempotent: everything is MERGEd on stable keys. Exits non-zero if the graph is unreachable
or ends inconsistent.
"""

import sys
import uuid

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import get_sessionmaker
from app.graph.client import Neo4jGraphClient
from app.intelligence.knowledge_store import consistency_report, sync_investigation_graph
from app.models import Investigation, Workspace


def main(argv: list[str]) -> int:
    settings = get_settings()
    if not settings.neo4j_configured:
        print("ASTRION_NEO4J_URI is not set; nothing to rebuild.", file=sys.stderr)
        return 2
    client = Neo4jGraphClient(settings)
    repo = client.repository()
    repo.ensure_schema()
    sessions = get_sessionmaker()
    failed = False
    with sessions() as db:
        ws_ids = [uuid.UUID(argv[0])] if argv else list(db.scalars(select(Workspace.id)))
        for ws in ws_ids:
            q = select(Investigation).where(Investigation.workspace_id == ws, Investigation.run_count > 0).order_by(Investigation.created_at)
            invs = list(db.scalars(q))
            for inv in invs:
                counts = sync_investigation_graph(db, repo, inv)
                db.commit()
                print(f"{ws} - {inv.title}: {counts['nodes']} nodes, {counts['relationships']} relationships")
            report = consistency_report(db, repo, ws)
            print(f"{ws}: consistent={report['consistent']}")
            failed |= not report["consistent"]
    client.close()
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
