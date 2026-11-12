"""Document storage: upload validation, safe naming, traversal protection, local + S3 backends."""

import hashlib
import io
import uuid

import pytest

from app.core.config import Settings
from app.storage import InvalidStorageKeyError, build_storage_key, validate_key
from app.storage.local import LocalStorage
from app.storage.validation import safe_filename

PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


@pytest.fixture()
def source(auth_client):
    ws = auth_client.post("/api/v1/workspaces", json={"name": "Storage WS"}).json()
    return auth_client.post(f"/api/v1/workspaces/{ws['id']}/sources", json={"title": "Paper", "source_type": "paper"}).json()


def upload(client, source, name, data, ctype, **form):
    return client.post(f"/api/v1/sources/{source['id']}/documents/upload", files={"file": (name, io.BytesIO(data), ctype)}, data=form)


def test_upload_and_download_roundtrip(auth_client, source, storage_root):
    r = upload(auth_client, source, "../../etc/Survey Report.pdf", PDF, "application/pdf", title="Survey")
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["has_file"] is True
    assert doc["title"] == "Survey"
    assert doc["original_filename"] == "Survey Report.pdf"  # directory components stripped
    assert doc["content_hash"] == hashlib.sha256(PDF).hexdigest()
    assert doc["byte_size"] == len(PDF)
    assert doc["processing_status"] == "registered"  # never parsed in this phase
    assert "storage_key" not in doc  # internal keys are not exposed
    # The file on disk lives under the storage root with a server-generated name.
    files = [p for p in storage_root.rglob("*") if p.is_file()]
    assert len(files) == 1 and files[0].name.endswith(".pdf") and "Survey" not in files[0].name

    dl = auth_client.get(f"/api/v1/documents/{doc['id']}/content")
    assert dl.status_code == 200
    assert dl.content == PDF
    assert dl.headers["content-disposition"].startswith("attachment;")
    assert dl.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in dl.headers["content-security-policy"]


@pytest.mark.parametrize(
    ("name", "data", "ctype", "status"),
    [
        ("malware.exe", b"MZ\x90\x00", "application/octet-stream", 415),
        ("fake.pdf", b"<html>not a pdf</html>", "application/pdf", 415),
        ("doc.pdf", PDF, "text/html", 415),
        ("binary.txt", b"abc\x00def", "text/plain", 415),
        ("empty.txt", b"", "text/plain", 415),
        ("noext", b"hello", "text/plain", 415),
    ],
)
def test_upload_rejections(auth_client, source, name, data, ctype, status):
    r = upload(auth_client, source, name, data, ctype)
    assert r.status_code == status, r.text


def test_upload_size_limit(auth_client, source, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.Settings, "max_upload_bytes", property(lambda self: 1024))
    r = upload(auth_client, source, "big.txt", b"a" * 2048, "text/plain")
    assert r.status_code == 413


def test_storage_key_fits_windows_path_limit():
    key = build_storage_key(uuid.uuid4(), uuid.uuid4(), "f" * 64, ".xlsx")
    assert len(key) <= 96


def test_local_write_failures_become_storage_errors(tmp_path, monkeypatch):
    from app.storage import StorageError

    storage = LocalStorage(tmp_path)
    key = build_storage_key(uuid.uuid4(), uuid.uuid4(), "a" * 64, ".txt")

    def boom(*_a, **_k):
        raise OSError(206, "The filename or extension is too long")

    monkeypatch.setattr("app.storage.local.tempfile.mkstemp", boom)
    with pytest.raises(StorageError):
        storage.put(key, io.BytesIO(b"x"), size=1, content_type="text/plain")


def test_storage_failure_returns_503_not_500(auth_client, source, app):
    from app.storage import StorageError, get_storage

    class BrokenStorage:
        name = "local"

        def put(self, *a, **k):
            raise StorageError("disk unavailable")

        def delete(self, key):
            pass

    app.dependency_overrides[get_storage] = lambda: BrokenStorage()
    r = upload(auth_client, source, "a.txt", b"hello", "text/plain")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "service_unavailable"


def test_metadata_only_document_has_no_content(auth_client, source):
    doc = auth_client.post(f"/api/v1/sources/{source['id']}/documents", json={"title": "x", "media_type": "application/pdf"}).json()
    assert doc["has_file"] is False
    assert auth_client.get(f"/api/v1/documents/{doc['id']}/content").status_code == 404


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../secret.txt", "secret.txt"),
        ("C:\\Windows\\system32\\evil.pdf", "evil.pdf"),
        ("rep\u202eort.pdf", "report.pdf"),  # right-to-left override removed
        ("a<b>:c|d?.md", "a_b_c_d_.md"),
        ("..", "document"),
        ("", "document"),
        ("   .hidden", "hidden"),
    ],
)
def test_safe_filename(raw, expected):
    assert safe_filename(raw) == expected


@pytest.mark.parametrize(
    "key",
    [
        "../../etc/passwd",
        "workspaces/../../x",
        "/abs/path",
        f"ws/{uuid.uuid4().hex}/doc/{uuid.uuid4().hex}/../../../x",
        f"workspaces/{uuid.uuid4()}/sources/{uuid.uuid4()}/documents/{uuid.uuid4()}/0123456789abcdef.pdf",  # old layout
        "C:\\windows\\x",
    ],
)
def test_traversal_keys_rejected(key, tmp_path):
    with pytest.raises(InvalidStorageKeyError):
        validate_key(key)
    with pytest.raises(InvalidStorageKeyError):
        LocalStorage(tmp_path).put(key, io.BytesIO(b"x"), size=1, content_type="text/plain")


def test_storage_key_is_stable_and_content_addressed():
    ids = [uuid.uuid4() for _ in range(2)]
    digest = hashlib.sha256(b"x").hexdigest()
    a = build_storage_key(*ids, digest, ".PDF")
    assert a == build_storage_key(*ids, digest, ".pdf")
    assert a.endswith(f"{digest[:16]}.pdf")
    assert build_storage_key(*ids, digest, "../x").endswith(digest[:16])  # bad extension dropped


def test_s3_backend_against_moto():
    """Exercises the real boto3 code path against moto's in-process S3 emulator (not a live AWS bucket)."""
    import boto3
    from moto import mock_aws

    from app.storage.s3 import S3Storage

    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="astrion-test")
        settings = Settings(ASTRION_STORAGE_BACKEND="s3", ASTRION_S3_BUCKET="astrion-test")
        s3 = S3Storage(settings, client=client)
        key = build_storage_key(uuid.uuid4(), uuid.uuid4(), hashlib.sha256(PDF).hexdigest(), ".pdf")
        s3.put(key, io.BytesIO(PDF), size=len(PDF), content_type="application/pdf")
        assert s3.exists(key)
        assert b"".join(s3.open(key)) == PDF
        head = client.head_object(Bucket="astrion-test", Key=key)
        assert head["ServerSideEncryption"] == "AES256"
        s3.delete(key)
        assert not s3.exists(key)
        with pytest.raises(InvalidStorageKeyError):
            s3.put("../escape", io.BytesIO(b"x"), size=1, content_type="text/plain")
