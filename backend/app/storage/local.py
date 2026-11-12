"""Local filesystem storage for development."""

import os
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

from app.storage.base import InvalidStorageKeyError, ObjectNotFoundError, StorageError, StoredObject, validate_key

CHUNK = 1024 * 256


class LocalStorage:
    name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        validate_key(key)
        path = (self.root / key).resolve()
        # Defence in depth: even a key that passed validation must stay inside the root.
        if not path.is_relative_to(self.root):
            raise InvalidStorageKeyError("Storage key escapes the storage root.")
        return path

    def put(self, key: str, data: BinaryIO, *, size: int, content_type: str) -> StoredObject:
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Write to a temp file in the same directory, then atomically replace.
            fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
        except OSError as exc:  # disk full, permissions, path too long, …
            raise StorageError(f"Local storage write failed: {type(exc).__name__}") from exc
        try:
            with os.fdopen(fd, "wb") as out:
                shutil.copyfileobj(data, out, CHUNK)
            os.replace(tmp, path)
        except OSError as exc:
            Path(tmp).unlink(missing_ok=True)
            raise StorageError(f"Local storage write failed: {type(exc).__name__}") from exc
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return StoredObject(key=key, size=path.stat().st_size, content_type=content_type)

    def open(self, key: str) -> Iterator[bytes]:
        path = self._path(key)
        if not path.is_file():
            raise ObjectNotFoundError(key)

        def _iter() -> Iterator[bytes]:
            with path.open("rb") as fh:
                while chunk := fh.read(CHUNK):
                    yield chunk

        return _iter()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)
