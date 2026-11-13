"""Source and document use-cases, scoped to the authenticated user.

Access to a source or document is granted only through its workspace's owner. A resource owned by
someone else is reported as not found. Phase 1.5 stores files but never parses them.
"""

import uuid
from collections.abc import Iterator
from typing import BinaryIO

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ServiceUnavailableError
from app.models import Document, Source, User, Workspace
from app.schemas.source import DocumentCreate, DocumentRead, SourceCreate, SourceRead
from app.services.workspaces import get_owned_workspace
from app.storage import ObjectNotFoundError, StorageBackend, StorageError, build_storage_key
from app.storage.validation import validate_upload


def _doc_counts(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = db.execute(select(Document.source_id, func.count()).where(Document.source_id.in_(ids)).group_by(Document.source_id))
    return {sid: n for sid, n in rows}


def _to_read(src: Source, doc_count: int) -> SourceRead:
    return SourceRead.model_validate(src).model_copy(update={"document_count": doc_count})


def create_source(db: Session, user: User, workspace_id: uuid.UUID, payload: SourceCreate) -> SourceRead:
    ws = get_owned_workspace(db, user, workspace_id)
    src = Source(
        workspace_id=ws.id,
        created_by_id=user.id,
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
    ws.updated_at = func.now()  # keeps "recently updated" ordering meaningful
    db.commit()
    db.refresh(src)
    return _to_read(src, 0)


def list_sources(db: Session, user: User, workspace_id: uuid.UUID, limit: int, offset: int) -> tuple[list[SourceRead], int]:
    get_owned_workspace(db, user, workspace_id)
    where = Source.workspace_id == workspace_id
    total = db.scalar(select(func.count()).select_from(Source).where(where)) or 0
    rows = list(db.scalars(select(Source).where(where).order_by(Source.created_at.desc(), Source.id).limit(limit).offset(offset)))
    counts = _doc_counts(db, [s.id for s in rows])
    return [_to_read(s, counts.get(s.id, 0)) for s in rows], total


def get_owned_source(db: Session, user: User, source_id: uuid.UUID) -> Source:
    src = db.scalar(select(Source).join(Workspace, Workspace.id == Source.workspace_id).where(Source.id == source_id, Workspace.owner_id == user.id))
    if src is None:
        raise NotFoundError(f"Source {source_id} was not found.")
    return src


def get_source(db: Session, user: User, source_id: uuid.UUID) -> SourceRead:
    src = get_owned_source(db, user, source_id)
    return _to_read(src, _doc_counts(db, [src.id]).get(src.id, 0))


def get_owned_document(db: Session, user: User, document_id: uuid.UUID) -> Document:
    doc = db.scalar(select(Document).join(Workspace, Workspace.id == Document.workspace_id).where(Document.id == document_id, Workspace.owner_id == user.id))
    if doc is None:
        raise NotFoundError(f"Document {document_id} was not found.")
    return doc


def create_document(db: Session, user: User, source_id: uuid.UUID, payload: DocumentCreate) -> DocumentRead:
    src = get_owned_source(db, user, source_id)
    doc = Document(workspace_id=src.workspace_id, source_id=src.id, **payload.model_dump())
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return DocumentRead.model_validate(doc)


def upload_document(
    db: Session,
    storage: StorageBackend,
    user: User,
    source_id: uuid.UUID,
    *,
    stream: BinaryIO,
    filename: str | None,
    declared_type: str | None,
    title: str | None,
    max_bytes: int,
) -> DocumentRead:
    src = get_owned_source(db, user, source_id)
    upload = validate_upload(stream, filename, declared_type, max_bytes=max_bytes)
    doc_id = uuid.uuid4()
    key = build_storage_key(src.workspace_id, doc_id, upload.sha256, upload.extension)
    try:
        storage.put(key, upload.file, size=upload.size, content_type=upload.content_type)
    except StorageError as exc:
        raise ServiceUnavailableError("The document could not be stored. Try again later.") from exc
    finally:
        upload.file.close()
    doc = Document(
        id=doc_id,
        workspace_id=src.workspace_id,
        source_id=src.id,
        title=(title or "").strip()[:500] or upload.filename,
        media_type=upload.content_type,
        byte_size=upload.size,
        content_hash=upload.sha256,
        storage_backend=storage.name,
        storage_key=key,
        original_filename=upload.filename,
    )
    db.add(doc)
    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(key)  # don't leave orphaned objects when metadata fails to persist
        raise
    db.refresh(doc)
    return DocumentRead.model_validate(doc)


def open_document_content(db: Session, storage: StorageBackend, user: User, document_id: uuid.UUID) -> tuple[Document, Iterator[bytes]]:
    doc = get_owned_document(db, user, document_id)
    if not doc.storage_key:
        raise NotFoundError("This document has metadata only; no file is stored.")
    if doc.storage_backend != storage.name:
        raise ServiceUnavailableError("The document's storage backend is not available on this server.")
    try:
        return doc, storage.open(doc.storage_key)
    except ObjectNotFoundError as exc:
        raise NotFoundError("The stored file is missing.") from exc
    except StorageError as exc:
        raise ServiceUnavailableError("The document could not be retrieved. Try again later.") from exc


def list_documents(db: Session, user: User, source_id: uuid.UUID, limit: int, offset: int) -> tuple[list[DocumentRead], int]:
    get_owned_source(db, user, source_id)
    where = Document.source_id == source_id
    total = db.scalar(select(func.count()).select_from(Document).where(where)) or 0
    rows = db.scalars(select(Document).where(where).order_by(Document.created_at.desc(), Document.id).limit(limit).offset(offset))
    return [DocumentRead.model_validate(d) for d in rows], total


def list_workspace_documents(db: Session, user: User, workspace_id: uuid.UUID, limit: int, offset: int) -> tuple[list[DocumentRead], int]:
    get_owned_workspace(db, user, workspace_id)
    where = Document.workspace_id == workspace_id
    total = db.scalar(select(func.count()).select_from(Document).where(where)) or 0
    rows = db.scalars(select(Document).where(where).order_by(Document.created_at.desc(), Document.id).limit(limit).offset(offset))
    return [DocumentRead.model_validate(d) for d in rows], total


def get_document(db: Session, user: User, document_id: uuid.UUID) -> DocumentRead:
    return DocumentRead.model_validate(get_owned_document(db, user, document_id))
