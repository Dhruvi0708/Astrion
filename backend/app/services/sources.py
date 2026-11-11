"""Source and document metadata use-cases. Phase 1 records metadata only — no file storage or parsing."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.models import Document, Source
from app.schemas.source import DocumentCreate, DocumentRead, SourceCreate, SourceRead
from app.services.workspaces import get_workspace_model


def _doc_counts(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = db.execute(select(Document.source_id, func.count()).where(Document.source_id.in_(ids)).group_by(Document.source_id))
    return {sid: n for sid, n in rows}


def _to_read(src: Source, doc_count: int) -> SourceRead:
    return SourceRead.model_validate(src).model_copy(update={"document_count": doc_count})


def create_source(db: Session, workspace_id: uuid.UUID, payload: SourceCreate) -> SourceRead:
    ws = get_workspace_model(db, workspace_id)
    src = Source(
        workspace_id=ws.id,
        title=payload.title,
        source_type=payload.source_type,
        uri=str(payload.uri) if payload.uri else None,
        citation=payload.citation,
        authors=payload.authors,
        published_on=payload.published_on,
        description=payload.description,
        attributes={},
    )
    db.add(src)
    ws.updated_at = func.now()  # touching the workspace keeps "recently updated" ordering meaningful
    db.commit()
    db.refresh(src)
    return _to_read(src, 0)


def list_sources(db: Session, workspace_id: uuid.UUID, limit: int, offset: int) -> tuple[list[SourceRead], int]:
    get_workspace_model(db, workspace_id)
    where = Source.workspace_id == workspace_id
    total = db.scalar(select(func.count()).select_from(Source).where(where)) or 0
    rows = list(db.scalars(select(Source).where(where).order_by(Source.created_at.desc(), Source.id).limit(limit).offset(offset)))
    counts = _doc_counts(db, [s.id for s in rows])
    return [_to_read(s, counts.get(s.id, 0)) for s in rows], total


def get_source_model(db: Session, source_id: uuid.UUID) -> Source:
    src = db.get(Source, source_id)
    if src is None:
        raise NotFoundError(f"Source {source_id} was not found.")
    return src


def get_source(db: Session, source_id: uuid.UUID) -> SourceRead:
    src = get_source_model(db, source_id)
    return _to_read(src, _doc_counts(db, [src.id]).get(src.id, 0))


def create_document(db: Session, source_id: uuid.UUID, payload: DocumentCreate) -> DocumentRead:
    src = get_source_model(db, source_id)
    doc = Document(workspace_id=src.workspace_id, source_id=src.id, **payload.model_dump())
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return DocumentRead.model_validate(doc)


def list_documents(db: Session, source_id: uuid.UUID, limit: int, offset: int) -> tuple[list[DocumentRead], int]:
    get_source_model(db, source_id)
    where = Document.source_id == source_id
    total = db.scalar(select(func.count()).select_from(Document).where(where)) or 0
    rows = db.scalars(select(Document).where(where).order_by(Document.created_at.desc(), Document.id).limit(limit).offset(offset))
    return [DocumentRead.model_validate(d) for d in rows], total


def get_document(db: Session, document_id: uuid.UUID) -> DocumentRead:
    doc = db.get(Document, document_id)
    if doc is None:
        raise NotFoundError(f"Document {document_id} was not found.")
    return DocumentRead.model_validate(doc)
