"""Typed application configuration loaded from environment variables (and an optional .env file)."""

import secrets
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Generated once per process when no secret is configured in development/test.
# Tokens signed with it stop validating on restart; refresh sessions (stored in the DB) still work.
_EPHEMERAL_JWT_SECRET = secrets.token_urlsafe(48)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Application
    app_name: str = "ASTRION API"
    environment: Literal["development", "test", "staging", "production"] = Field(default="development", alias="ASTRION_ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="ASTRION_LOG_LEVEL")
    log_json: bool = Field(default=True, alias="ASTRION_LOG_JSON")
    cors_origins: Annotated[list[str], NoDecode] = Field(default=["http://localhost:5173", "http://127.0.0.1:5173"], alias="ASTRION_CORS_ORIGINS")

    # PostgreSQL
    database_url: str = Field(default="postgresql+psycopg://astrion:astrion@localhost:5432/astrion", alias="ASTRION_DATABASE_URL")
    database_echo: bool = Field(default=False, alias="ASTRION_DATABASE_ECHO")

    # Authentication
    jwt_secret: SecretStr | None = Field(default=None, alias="ASTRION_JWT_SECRET")
    jwt_issuer: str = Field(default="astrion-api", alias="ASTRION_JWT_ISSUER")
    access_token_ttl_minutes: int = Field(default=15, ge=1, le=120, alias="ASTRION_ACCESS_TOKEN_TTL_MINUTES")
    refresh_token_ttl_days: int = Field(default=14, ge=1, le=90, alias="ASTRION_REFRESH_TOKEN_TTL_DAYS")
    cookie_secure: bool = Field(default=False, alias="ASTRION_COOKIE_SECURE")
    login_max_failures: int = Field(default=8, ge=1, alias="ASTRION_LOGIN_MAX_FAILURES")
    login_window_seconds: int = Field(default=900, ge=60, alias="ASTRION_LOGIN_WINDOW_SECONDS")

    # Neo4j — optional. An empty URI means "not configured" rather than an error.
    neo4j_uri: str | None = Field(default=None, alias="ASTRION_NEO4J_URI")
    neo4j_user: str = Field(default="neo4j", alias="ASTRION_NEO4J_USER")
    neo4j_password: SecretStr = Field(default=SecretStr(""), alias="ASTRION_NEO4J_PASSWORD")
    neo4j_database: str = Field(default="neo4j", alias="ASTRION_NEO4J_DATABASE")
    neo4j_timeout_seconds: float = Field(default=3.0, gt=0, alias="ASTRION_NEO4J_TIMEOUT_SECONDS")
    neo4j_query_timeout_seconds: float = Field(default=10.0, gt=0, alias="ASTRION_NEO4J_QUERY_TIMEOUT_SECONDS")

    # Document storage
    storage_backend: Literal["local", "s3"] = Field(default="local", alias="ASTRION_STORAGE_BACKEND")
    storage_local_root: Path = Field(default=Path("./var/storage"), alias="ASTRION_STORAGE_LOCAL_ROOT")
    storage_max_upload_mb: int = Field(default=50, ge=1, le=2048, alias="ASTRION_STORAGE_MAX_UPLOAD_MB")
    s3_bucket: str | None = Field(default=None, alias="ASTRION_S3_BUCKET")
    s3_endpoint_url: str | None = Field(default=None, alias="ASTRION_S3_ENDPOINT_URL")
    s3_region: str = Field(default="us-east-1", alias="ASTRION_S3_REGION")
    s3_access_key_id: SecretStr | None = Field(default=None, alias="ASTRION_S3_ACCESS_KEY_ID")
    s3_secret_access_key: SecretStr | None = Field(default=None, alias="ASTRION_S3_SECRET_ACCESS_KEY")

    # AI providers (server-side only)
    anthropic_api_key: SecretStr | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    llm_model: str = Field(default="claude-opus-5-5", alias="ASTRION_LLM_MODEL")
    # Explicit, ordered fallback models. Empty (default) = never fall back.
    llm_fallback_models: Annotated[list[str], NoDecode] = Field(default=[], alias="ASTRION_LLM_FALLBACK_MODELS")
    voyage_api_key: SecretStr | None = Field(default=None, alias="VOYAGE_API_KEY")
    embedding_model: str = Field(default="voyage-3.5", alias="ASTRION_EMBEDDING_MODEL")

    @field_validator("cors_origins", "llm_fallback_models", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("neo4j_uri", "s3_endpoint_url", "s3_bucket", mode="before")
    @classmethod
    def _empty_is_none(cls, value: object) -> object:
        return None if value in ("", None) else value

    @model_validator(mode="after")
    def _production_safety(self) -> "Settings":
        if self.environment in ("staging", "production"):
            secret = self.jwt_secret.get_secret_value() if self.jwt_secret else ""
            if len(secret) < 32:
                raise ValueError("ASTRION_JWT_SECRET must be set to at least 32 characters outside development.")
            if not self.cookie_secure:
                raise ValueError("ASTRION_COOKIE_SECURE must be true outside development.")
        if self.storage_backend == "s3" and not self.s3_bucket:
            raise ValueError("ASTRION_S3_BUCKET is required when ASTRION_STORAGE_BACKEND=s3.")
        return self

    @property
    def neo4j_configured(self) -> bool:
        return bool(self.neo4j_uri)

    @property
    def jwt_signing_key(self) -> str:
        if self.jwt_secret and self.jwt_secret.get_secret_value():
            return self.jwt_secret.get_secret_value()
        return _EPHEMERAL_JWT_SECRET

    @property
    def max_upload_bytes(self) -> int:
        return self.storage_max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
