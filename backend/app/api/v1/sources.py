import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, File, Form, UploadFile, status
from fastapi.responses import StreamingResponse

from app.api.deps import AppSettings, CurrentUser, DbSession, Limit, Offset, Storage
from app.schemas.common import ErrorResponse, Page
from app.schemas.source import DocumentCreate, DocumentRead, SourceRead
from app.services import sources as source_service

router = APIRouter(tags=["sources"])
ERRORS = {401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}
UPLOAD_ERRORS = {**ERRORS, 413: {"model": ErrorResponse}, 415: {"model": ErrorResponse}}


@router.get("/sources/{source_id}", response_model=SourceRead, responses=ERRORS, summary="Get a source")
def get_source(source_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SourceRead:
    return source_service.get_source(db, user, source_id)


@router.post(
    "/sources/{source_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
    responses=ERRORS,
    summary="Register document metadata (no file)",
)
def create_document(source_id: uuid.UUID, payload: DocumentCreate, user: CurrentUser, db: DbSession) -> DocumentRead:
    return source_service.create_document(db, user, source_id, payload)


@router.post(
    "/sources/{source_id}/documents/upload",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
    responses=UPLOAD_ERRORS,
    summary="Upload and store a document file (not parsed)",
)
def upload_document(
    source_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    settings: AppSettings,
    file: Annotated[UploadFile, File(description="Document file")],
    title: Annotated[str | None, Form(max_length=500)] = None,
) -> DocumentRead:
    return source_service.upload_document(
        db,
        storage,
        user,
        source_id,
        stream=file.file,
        filename=file.filename,
        declared_type=file.content_type,
        title=title,
        max_bytes=settings.max_upload_bytes,
    )


@router.get("/sources/{source_id}/documents", response_model=Page[DocumentRead], responses=ERRORS, summary="List documents of a source")
def list_documents(source_id: uuid.UUID, user: CurrentUser, db: DbSession, limit: Limit = 50, offset: Offset = 0) -> Page[DocumentRead]:
    items, total = source_service.list_documents(db, user, source_id, limit, offset)
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/documents/{document_id}", response_model=DocumentRead, responses=ERRORS, summary="Get a document")
def get_document(document_id: uuid.UUID, user: CurrentUser, db: DbSession) -> DocumentRead:
    return source_service.get_document(db, user, document_id)


@router.get("/documents/{document_id}/content", responses=ERRORS, summary="Download a stored document file")
def download_document(document_id: uuid.UUID, user: CurrentUser, db: DbSession, storage: Storage) -> StreamingResponse:
    doc, chunks = source_service.open_document_content(db, storage, user, document_id)
    filename = doc.original_filename or "document"
    headers = {
        # Always download, never render inline: uploaded HTML must not execute in the API origin.
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
    }
    if doc.byte_size is not None:
        headers["Content-Length"] = str(doc.byte_size)
    return StreamingResponse(chunks, media_type=doc.media_type, headers=headers)
