from functools import lru_cache

from app.core.config import get_settings
from app.storage.base import (
    InvalidStorageKeyError,
    ObjectNotFoundError,
    StorageBackend,
    StorageError,
    StoredObject,
    build_storage_key,
    validate_key,
)


@lru_cache
def get_storage() -> StorageBackend:
    settings = get_settings()
    if settings.storage_backend == "s3":
        from app.storage.s3 import S3Storage

        return S3Storage(settings)
    from app.storage.local import LocalStorage

    return LocalStorage(settings.storage_local_root)


__all__ = [
    "InvalidStorageKeyError",
    "ObjectNotFoundError",
    "StorageBackend",
    "StorageError",
    "StoredObject",
    "build_storage_key",
    "get_storage",
    "validate_key",
]
