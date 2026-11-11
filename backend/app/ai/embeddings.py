"""Embedding provider abstraction.

Anthropic does not offer an embeddings endpoint; Voyage AI is the planned default. Phase 1 defines
the interface and an HTTP implementation; nothing in the API calls it yet.
"""

from functools import lru_cache
from typing import Literal, Protocol

import httpx

from app.ai.llm import ProviderNotConfiguredError
from app.core.config import Settings, get_settings

InputType = Literal["document", "query"]


class EmbeddingProvider(Protocol):
    name: str

    @property
    def configured(self) -> bool: ...

    def embed(self, texts: list[str], *, input_type: InputType = "document") -> list[list[float]]: ...


class NullEmbeddingProvider:
    name = "none"
    configured = False

    def embed(self, texts: list[str], *, input_type: InputType = "document") -> list[list[float]]:
        raise ProviderNotConfiguredError("No embedding provider is configured. Set VOYAGE_API_KEY on the server.")


class VoyageEmbeddingProvider:
    name = "voyage"
    configured = True
    _URL = "https://api.voyageai.com/v1/embeddings"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self._key = settings.voyage_api_key.get_secret_value() if settings.voyage_api_key else ""
        self.model = settings.embedding_model
        self._client = client or httpx.Client(timeout=30)

    def embed(self, texts: list[str], *, input_type: InputType = "document") -> list[list[float]]:
        if not texts:
            return []
        response = self._client.post(
            self._URL,
            headers={"Authorization": f"Bearer {self._key}"},
            json={"input": texts, "model": self.model, "input_type": input_type},
        )
        response.raise_for_status()
        data = sorted(response.json()["data"], key=lambda d: d["index"])
        return [d["embedding"] for d in data]


@lru_cache
def get_embedding_provider() -> EmbeddingProvider:
    settings = get_settings()
    if settings.voyage_api_key and settings.voyage_api_key.get_secret_value():
        return VoyageEmbeddingProvider(settings)
    return NullEmbeddingProvider()
