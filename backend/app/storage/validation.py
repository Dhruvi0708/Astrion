"""Upload validation: filename sanitisation, type allow-list, content sniffing and size limits."""

import hashlib
import re
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath
from typing import BinaryIO

from app.core.errors import PayloadTooLargeError, UnsupportedMediaTypeError

CHUNK = 1024 * 256

# extension -> (canonical MIME type, MIME types a client may declare)
ALLOWED_TYPES: dict[str, tuple[str, frozenset[str]]] = {
    ".pdf": ("application/pdf", frozenset({"application/pdf", "application/x-pdf"})),
    ".txt": ("text/plain", frozenset({"text/plain"})),
    ".md": ("text/markdown", frozenset({"text/markdown", "text/plain", "text/x-markdown"})),
    ".csv": ("text/csv", frozenset({"text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"})),
    ".json": ("application/json", frozenset({"application/json", "text/plain"})),
    ".html": ("text/html", frozenset({"text/html"})),
    ".docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        frozenset({"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"}),
    ),
    ".xlsx": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        frozenset({"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"}),
    ),
}
TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".html"}
ZIP_EXTENSIONS = {".docx", ".xlsx"}
_SAFE_CHARS = re.compile(r"[^A-Za-z0-9 ._()\-]+")


def safe_filename(raw: str | None, fallback: str = "document") -> str:
    """Returns a display-safe filename. It is never used to build a storage path."""
    name = raw or ""
    # Strip any directory component regardless of separator style.
    name = PureWindowsPath(PurePosixPath(name).name).name
    name = unicodedata.normalize("NFKC", name)
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")  # control / format chars
    name = _SAFE_CHARS.sub("_", name).strip(" .")
    name = re.sub(r"_+", "_", name)
    if not name or name in {".", ".."}:
        name = fallback
    stem, dot, ext = name.rpartition(".")
    if dot and len(name) > 200:
        name = f"{stem[: 200 - len(ext) - 1]}.{ext}"
    return name[:200]


def extension_of(filename: str) -> str:
    suffix = PurePosixPath(filename).suffix.lower()
    return suffix


@dataclass
class ValidatedUpload:
    file: BinaryIO  # spooled temp file positioned at 0
    size: int
    sha256: str
    extension: str
    content_type: str
    filename: str


def _sniff(ext: str, head: bytes) -> bool:
    if ext == ".pdf":
        return head.startswith(b"%PDF-")
    if ext in ZIP_EXTENSIONS:
        return head.startswith(b"PK\x03\x04")
    if ext in TEXT_EXTENSIONS:
        if b"\x00" in head:
            return False
        try:
            head.decode("utf-8")
        except UnicodeDecodeError as exc:
            # A multi-byte character may be split at the sniff boundary.
            return exc.start >= len(head) - 3
        return True
    return False


def validate_upload(stream: BinaryIO, filename: str | None, declared_type: str | None, *, max_bytes: int) -> ValidatedUpload:
    name = safe_filename(filename)
    ext = extension_of(name)
    if ext not in ALLOWED_TYPES:
        allowed = ", ".join(sorted(ALLOWED_TYPES))
        raise UnsupportedMediaTypeError(f"File type not allowed. Allowed extensions: {allowed}.")
    canonical, accepted = ALLOWED_TYPES[ext]
    declared = (declared_type or "").split(";")[0].strip().lower()
    if declared and declared not in accepted:
        raise UnsupportedMediaTypeError(f"Declared content type {declared!r} does not match a {ext} file.")

    out = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)  # noqa: SIM115 — returned open; the caller closes it
    digest = hashlib.sha256()
    size = 0
    head = b""
    while chunk := stream.read(CHUNK):
        size += len(chunk)
        if size > max_bytes:
            out.close()
            raise PayloadTooLargeError(f"File exceeds the {max_bytes // (1024 * 1024)} MB upload limit.")
        if len(head) < 4096:
            head += chunk[: 4096 - len(head)]
        digest.update(chunk)
        out.write(chunk)
    if size == 0:
        out.close()
        raise UnsupportedMediaTypeError("The uploaded file is empty.")
    if not _sniff(ext, head):
        out.close()
        raise UnsupportedMediaTypeError(f"File contents do not look like a {ext} file.")
    out.seek(0)
    return ValidatedUpload(file=out, size=size, sha256=digest.hexdigest(), extension=ext, content_type=canonical, filename=name)
