"""S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, …) via boto3."""

from collections.abc import Iterator
from typing import Any, BinaryIO

from app.core.config import Settings
from app.storage.base import ObjectNotFoundError, StorageError, StoredObject, validate_key

CHUNK = 1024 * 256


class S3Storage:
    name = "s3"

    def __init__(self, settings: Settings, client: Any | None = None) -> None:
        if client is None:
            import boto3  # optional dependency: install the "s3" extra

            client = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint_url,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key_id.get_secret_value() if settings.s3_access_key_id else None,
                aws_secret_access_key=settings.s3_secret_access_key.get_secret_value() if settings.s3_secret_access_key else None,
            )
        self._client = client
        self._bucket = settings.s3_bucket

    def put(self, key: str, data: BinaryIO, *, size: int, content_type: str) -> StoredObject:
        validate_key(key)
        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentLength=size,
                ContentType=content_type,
                ServerSideEncryption="AES256",
            )
        except Exception as exc:  # botocore raises many types; normalise them
            raise StorageError(f"S3 upload failed: {type(exc).__name__}") from exc
        return StoredObject(key=key, size=size, content_type=content_type)

    def open(self, key: str) -> Iterator[bytes]:
        validate_key(key)
        from botocore.exceptions import ClientError

        try:
            obj = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                raise ObjectNotFoundError(key) from exc
            raise StorageError(f"S3 download failed: {exc.response.get('Error', {}).get('Code')}") from exc
        return obj["Body"].iter_chunks(CHUNK)

    def exists(self, key: str) -> bool:
        validate_key(key)
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError:
            return False

    def delete(self, key: str) -> None:
        validate_key(key)
        self._client.delete_object(Bucket=self._bucket, Key=key)
