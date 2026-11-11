import uuid

from fastapi import APIRouter, status

from app.api.deps import DbSession, Limit, Offset
from app.schemas.common import ErrorResponse, Page
from app.schemas.source import DocumentCreate, DocumentRead, SourceRead
from app.services import sources as source_service

router = APIRouter(tags=["sources"])
NOT_FOUND = {404: {"model": ErrorResponse}}


@router.get("/sources/{source_id}", response_model=SourceRead, responses=NOT_FOUND, summary="Get a source")
def get_source(source_id: uuid.UUID, db: DbSession) -> SourceRead:
    return source_service.get_source(db, source_id)


@router.post(
    "/sources/{source_id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
    responses=NOT_FOUND,
    summary="Register document metadata for a source",
)
def create_document(source_id: uuid.UUID, payload: DocumentCreate, db: DbSession) -> DocumentRead:
    return source_service.create_document(db, source_id, payload)


@router.get("/sources/{source_id}/documents", response_model=Page[DocumentRead], responses=NOT_FOUND, summary="List documents of a source")
def list_documents(source_id: uuid.UUID, db: DbSession, limit: Limit = 50, offset: Offset = 0) -> Page[DocumentRead]:
    items, total = source_service.list_documents(db, source_id, limit, offset)
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/documents/{document_id}", response_model=DocumentRead, responses=NOT_FOUND, summary="Get a document")
def get_document(document_id: uuid.UUID, db: DbSession) -> DocumentRead:
    return source_service.get_document(db, document_id)
