import pytest

from app.ai.embeddings import NullEmbeddingProvider, VoyageEmbeddingProvider
from app.ai.llm import NullLLMProvider, ProviderNotConfiguredError
from app.core.config import Settings
from app.graph.client import UnconfiguredGraphClient
from app.graph.model import SCHEMA_STATEMENTS
from app.services.workspaces import slugify


def test_settings_parse_env(monkeypatch):
    monkeypatch.setenv("ASTRION_CORS_ORIGINS", "http://a.test, http://b.test")
    monkeypatch.setenv("ASTRION_NEO4J_URI", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-real")
    s = Settings()
    assert s.cors_origins == ["http://a.test", "http://b.test"]
    assert s.neo4j_configured is False
    # Secrets never appear in reprs or dumps.
    assert "sk-test-not-real" not in repr(s)
    assert "sk-test-not-real" not in s.model_dump_json()


def test_null_providers_fail_explicitly():
    with pytest.raises(ProviderNotConfiguredError):
        NullLLMProvider().complete([])
    with pytest.raises(ProviderNotConfiguredError):
        NullEmbeddingProvider().embed(["x"])


def test_voyage_provider_orders_by_index():
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer k"
        return httpx.Response(200, json={"data": [{"index": 1, "embedding": [2.0]}, {"index": 0, "embedding": [1.0]}]})

    settings = Settings(VOYAGE_API_KEY="k")
    provider = VoyageEmbeddingProvider(settings, client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert provider.embed(["a", "b"]) == [[1.0], [2.0]]
    assert provider.embed([]) == []


def test_unconfigured_graph_is_honest():
    assert UnconfiguredGraphClient().health().status == "not_configured"


def test_graph_schema_statements_cover_labels():
    assert all("IF NOT EXISTS" in s for s in SCHEMA_STATEMENTS)
    assert len(SCHEMA_STATEMENTS) == 5


@pytest.mark.parametrize(("raw", "slug"), [("Café Résumé", "cafe-resume"), ("***", "workspace"), ("A  B", "a-b")])
def test_slugify(raw, slug):
    assert slugify(raw) == slug
