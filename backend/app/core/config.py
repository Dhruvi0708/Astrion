"""Typed application configuration loaded from environment variables (and an optional .env file)."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Application
    app_name: str = "ASTRION API"
    environment: Literal["development", "test", "staging", "production"] = Field(default="development", alias="ASTRION_ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="ASTRION_LOG_LEVEL")
    log_json: bool = Field(default=True, alias="ASTRION_LOG_JSON")
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default=["http://localhost:5173", "http://127.0.0.1:5173"], alias="ASTRION_CORS_ORIGINS"
    )

    # PostgreSQL
    database_url: str = Field(
        default="postgresql+psycopg://astrion:astrion@localhost:5432/astrion", alias="ASTRION_DATABASE_URL"
    )
    database_echo: bool = Field(default=False, alias="ASTRION_DATABASE_ECHO")

    # Neo4j — optional. An empty URI means "not configured" rather than an error.
    neo4j_uri: str | None = Field(default=None, alias="ASTRION_NEO4J_URI")
    neo4j_user: str = Field(default="neo4j", alias="ASTRION_NEO4J_USER")
    neo4j_password: SecretStr = Field(default=SecretStr(""), alias="ASTRION_NEO4J_PASSWORD")
    neo4j_database: str = Field(default="neo4j", alias="ASTRION_NEO4J_DATABASE")
    neo4j_timeout_seconds: float = Field(default=3.0, alias="ASTRION_NEO4J_TIMEOUT_SECONDS")

    # AI providers (server-side only)
    anthropic_api_key: SecretStr | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    llm_model: str = Field(default="claude-opus-5-5", alias="ASTRION_LLM_MODEL")
    voyage_api_key: SecretStr | None = Field(default=None, alias="VOYAGE_API_KEY")
    embedding_model: str = Field(default="voyage-3.5", alias="ASTRION_EMBEDDING_MODEL")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("neo4j_uri", mode="before")
    @classmethod
    def _empty_uri_is_none(cls, value: object) -> object:
        return None if value in ("", None) else value

    @property
    def neo4j_configured(self) -> bool:
        return bool(self.neo4j_uri)


@lru_cache
def get_settings() -> Settings:
    return Settings()
