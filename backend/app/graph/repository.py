"""Neo4j graph repository: node/relationship CRUD, schema management and explicit transactions.

Safety
* Labels and relationship types can't be query parameters in Cypher, so they're interpolated
  **only** after validation against the ``NodeLabel`` / ``RelType`` enums. Everything else is a parameter.
* Every query is scoped by ``workspace_id`` and carries a server-side timeout.
* ``key`` and ``workspace_id`` can't be overwritten through ``properties``.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from neo4j import Driver, unit_of_work
from neo4j.exceptions import AuthError, Neo4jError, ServiceUnavailable, SessionExpired, TransientError

from app.graph.model import NodeLabel, RelType, is_valid_key

RESERVED = {"key", "workspace_id", "created_at", "updated_at"}
_PRIMITIVES = (str, int, float, bool, date, datetime)


class GraphError(Exception):
    pass


class GraphUnavailableError(GraphError):
    """Neo4j could not be reached, or credentials were rejected."""


class GraphNotFoundError(GraphError):
    pass


class GraphValidationError(GraphError, ValueError):
    pass


@dataclass(frozen=True)
class GraphNode:
    label: str
    key: str
    workspace_id: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GraphRel:
    type: str
    key: str
    workspace_id: str
    from_key: str
    to_key: str
    properties: dict[str, Any] = field(default_factory=dict)


def _label(label: NodeLabel | str) -> str:
    try:
        return NodeLabel(label).value
    except ValueError as exc:
        raise GraphValidationError(f"Unknown node label: {label!r}") from exc


def _rel_type(rel: RelType | str) -> str:
    try:
        return RelType(rel).value
    except ValueError as exc:
        raise GraphValidationError(f"Unknown relationship type: {rel!r}") from exc


def _key(key: str) -> str:
    if not is_valid_key(key):
        raise GraphValidationError(f"Invalid graph key: {key!r}")
    return key


def _props(properties: dict[str, Any] | None) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for name, value in (properties or {}).items():
        if name in RESERVED or not name.isidentifier():
            raise GraphValidationError(f"Property name not allowed: {name!r}")
        ok = value is None or isinstance(value, _PRIMITIVES) or (isinstance(value, list) and all(isinstance(v, _PRIMITIVES) for v in value))
        if not ok:
            raise GraphValidationError(f"Property {name!r} must be a primitive or a list of primitives.")
        clean[name] = value
    return clean


def _public(props: dict[str, Any]) -> dict[str, Any]:
    return {k: (v.iso_format() if hasattr(v, "iso_format") else v) for k, v in props.items() if k not in ("key", "workspace_id")}


def _node(record_node: Any) -> GraphNode:
    props = dict(record_node)
    label = next(iter(record_node.labels))
    return GraphNode(label=label, key=props["key"], workspace_id=props["workspace_id"], properties=_public(props))


def _rel(record_rel: Any, from_key: str, to_key: str) -> GraphRel:
    props = dict(record_rel)
    return GraphRel(type=record_rel.type, key=props["key"], workspace_id=props["workspace_id"], from_key=from_key, to_key=to_key, properties=_public(props))


class GraphOps:
    """Operations bound to one transaction (managed or explicit)."""

    def __init__(self, tx: Any, timeout: float) -> None:
        self._tx = tx
        self._timeout = timeout

    def _run(self, cypher: str, **params: Any) -> Any:
        # The timeout is applied to the enclosing transaction (unit_of_work / begin_transaction).
        return self._tx.run(cypher, **params)

    def upsert_node(self, workspace_id: str, label: NodeLabel | str, key: str, properties: dict[str, Any] | None = None) -> GraphNode:
        lbl = _label(label)
        rec = self._run(
            f"MERGE (n:{lbl} {{workspace_id: $ws, key: $key}}) "
            "ON CREATE SET n.created_at = datetime() "
            "SET n += $props, n.updated_at = datetime() RETURN n",
            ws=workspace_id,
            key=_key(key),
            props=_props(properties),
        ).single()
        return _node(rec["n"])

    def get_node(self, workspace_id: str, key: str) -> GraphNode | None:
        rec = self._run("MATCH (n {workspace_id: $ws, key: $key}) RETURN n LIMIT 1", ws=workspace_id, key=_key(key)).single()
        return _node(rec["n"]) if rec else None

    def delete_node(self, workspace_id: str, key: str) -> bool:
        rec = self._run("MATCH (n {workspace_id: $ws, key: $key}) WITH n, count(n) AS c DETACH DELETE n RETURN c", ws=workspace_id, key=_key(key)).single()
        return bool(rec and rec["c"])

    def upsert_relationship(
        self,
        workspace_id: str,
        rel_type: RelType | str,
        key: str,
        from_key: str,
        to_key: str,
        properties: dict[str, Any] | None = None,
    ) -> GraphRel:
        typ = _rel_type(rel_type)
        if from_key == to_key:
            raise GraphValidationError("Self-relationships are not allowed.")
        rec = self._run(
            "MATCH (a {workspace_id: $ws, key: $from_key}), (b {workspace_id: $ws, key: $to_key}) "
            f"MERGE (a)-[r:{typ} {{workspace_id: $ws, key: $key}}]->(b) "
            "ON CREATE SET r.created_at = datetime() "
            "SET r += $props, r.updated_at = datetime() RETURN r",
            ws=workspace_id,
            key=_key(key),
            from_key=_key(from_key),
            to_key=_key(to_key),
            props=_props(properties),
        ).single()
        if rec is None:
            raise GraphNotFoundError("Both endpoint nodes must exist in the same workspace.")
        return _rel(rec["r"], from_key, to_key)

    def get_relationship(self, workspace_id: str, key: str) -> GraphRel | None:
        rec = self._run("MATCH (a)-[r {workspace_id: $ws, key: $key}]->(b) RETURN r, a.key AS a, b.key AS b LIMIT 1", ws=workspace_id, key=_key(key)).single()
        return _rel(rec["r"], rec["a"], rec["b"]) if rec else None

    def delete_relationship(self, workspace_id: str, key: str) -> bool:
        rec = self._run("MATCH ()-[r {workspace_id: $ws, key: $key}]->() WITH r, count(r) AS c DELETE r RETURN c", ws=workspace_id, key=_key(key)).single()
        return bool(rec and rec["c"])

    def neighbours(self, workspace_id: str, key: str, limit: int = 100) -> list[tuple[GraphRel, GraphNode]]:
        result = self._run(
            "MATCH (n {workspace_id: $ws, key: $key})-[r]-(m {workspace_id: $ws}) "
            "RETURN r, startNode(r).key AS a, endNode(r).key AS b, m ORDER BY r.key LIMIT $limit",
            ws=workspace_id,
            key=_key(key),
            limit=max(1, min(limit, 1000)),
        )
        return [(_rel(rec["r"], rec["a"], rec["b"]), _node(rec["m"])) for rec in result]

    def count(self, workspace_id: str) -> tuple[int, int]:
        rec = self._run(
            "CALL { MATCH (n {workspace_id: $ws}) RETURN count(n) AS nodes } "
            "CALL { MATCH ()-[r {workspace_id: $ws}]->() RETURN count(r) AS rels } RETURN nodes, rels",
            ws=workspace_id,
        ).single()
        return rec["nodes"], rec["rels"]

    def clear_workspace(self, workspace_id: str) -> None:
        self._run("MATCH (n {workspace_id: $ws}) DETACH DELETE n", ws=workspace_id)


def _translate(exc: Exception) -> GraphError:
    if isinstance(exc, AuthError):
        return GraphUnavailableError("Neo4j rejected the configured credentials.")
    if isinstance(exc, (ServiceUnavailable, SessionExpired, OSError)):
        return GraphUnavailableError("Neo4j is unreachable.")
    if isinstance(exc, (Neo4jError, TransientError)):
        return GraphError(f"Neo4j error: {getattr(exc, 'code', type(exc).__name__)}")
    return GraphError(str(exc))


class GraphRepository:
    def __init__(self, driver: Driver, database: str, query_timeout: float) -> None:
        self._driver = driver
        self._database = database
        self._timeout = query_timeout

    def _write(self, fn: Any) -> Any:
        try:
            with self._driver.session(database=self._database) as session:
                return session.execute_write(unit_of_work(timeout=self._timeout)(lambda tx: fn(GraphOps(tx, self._timeout))))
        except GraphError:
            raise
        except Exception as exc:
            raise _translate(exc) from exc

    def _read(self, fn: Any) -> Any:
        try:
            with self._driver.session(database=self._database) as session:
                return session.execute_read(unit_of_work(timeout=self._timeout)(lambda tx: fn(GraphOps(tx, self._timeout))))
        except GraphError:
            raise
        except Exception as exc:
            raise _translate(exc) from exc

    @contextmanager
    def transaction(self) -> Iterator[GraphOps]:
        """Explicit multi-operation transaction: commits on success, rolls back on any exception."""
        try:
            session = self._driver.session(database=self._database)
        except Exception as exc:
            raise _translate(exc) from exc
        try:
            tx = session.begin_transaction(timeout=self._timeout)
            try:
                yield GraphOps(tx, self._timeout)
                tx.commit()
            except BaseException:
                if not tx.closed():
                    tx.rollback()
                raise
        except GraphError:
            raise
        except (Neo4jError, ServiceUnavailable, SessionExpired, OSError) as exc:
            raise _translate(exc) from exc
        finally:
            session.close()

    def ensure_schema(self) -> list[str]:
        from app.graph.model import SCHEMA_STATEMENTS

        try:
            with self._driver.session(database=self._database) as session:
                for statement in SCHEMA_STATEMENTS:
                    session.run(statement).consume()  # schema commands use auto-commit transactions
        except Exception as exc:
            raise _translate(exc) from exc
        return list(SCHEMA_STATEMENTS)

    def upsert_node(self, *a: Any, **k: Any) -> GraphNode:
        return self._write(lambda ops: ops.upsert_node(*a, **k))

    def get_node(self, *a: Any, **k: Any) -> GraphNode | None:
        return self._read(lambda ops: ops.get_node(*a, **k))

    def delete_node(self, *a: Any, **k: Any) -> bool:
        return self._write(lambda ops: ops.delete_node(*a, **k))

    def upsert_relationship(self, *a: Any, **k: Any) -> GraphRel:
        return self._write(lambda ops: ops.upsert_relationship(*a, **k))

    def get_relationship(self, *a: Any, **k: Any) -> GraphRel | None:
        return self._read(lambda ops: ops.get_relationship(*a, **k))

    def delete_relationship(self, *a: Any, **k: Any) -> bool:
        return self._write(lambda ops: ops.delete_relationship(*a, **k))

    def neighbours(self, *a: Any, **k: Any) -> list[tuple[GraphRel, GraphNode]]:
        return self._read(lambda ops: ops.neighbours(*a, **k))

    def count(self, workspace_id: str) -> tuple[int, int]:
        return self._read(lambda ops: ops.count(workspace_id))

    def clear_workspace(self, workspace_id: str) -> None:
        self._write(lambda ops: ops.clear_workspace(workspace_id))
