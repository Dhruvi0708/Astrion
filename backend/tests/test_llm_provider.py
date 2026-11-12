"""Claude provider integrity, tested with a fake SDK client (no network, nothing billed).

These tests do NOT verify the model against Anthropic's live API — see app.ai.check for that.
"""

from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from app.ai.llm import (
    ClaudeProvider,
    LLMMessage,
    ProviderAuthError,
    ProviderModelNotFoundError,
    ProviderRateLimitError,
    ProviderRefusalError,
    ProviderUnavailableError,
)
from app.core.config import Settings


def _message(model="claude-opus-5-5", stop_reason="end_turn", text="ok", category=None):
    msg = SimpleNamespace(
        model=model,
        stop_reason=stop_reason,
        stop_details=SimpleNamespace(category=category, explanation="declined") if stop_reason == "refusal" else None,
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=11, output_tokens=7),
    )
    msg._request_id = f"req_{model}"
    return msg


class FakeStream:
    def __init__(self, result):
        self._result = result

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class FakeClient:
    def __init__(self, results, model_ids=("claude-opus-5-5",)):
        self.calls = []
        self._results = list(results)
        self._model_ids = set(model_ids)
        self.messages = SimpleNamespace(stream=self._stream)
        self.models = SimpleNamespace(retrieve=self._retrieve)

    def _stream(self, **kwargs):
        self.calls.append(kwargs)
        return FakeStream(self._results.pop(0))

    def _retrieve(self, model_id):
        if model_id not in self._model_ids:
            raise _status_error(anthropic.NotFoundError, 404, "not_found_error")
        return SimpleNamespace(id=model_id, display_name="Claude Opus 5.5")


def _status_error(cls, status, etype):
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    resp = httpx2.Response(status, request=req, headers={"request-id": "req_err"})
    return cls(f"{etype} happened", response=resp, body={"type": "error", "error": {"type": etype, "message": "x"}})


def provider(results, fallbacks="", **kw):
    settings = Settings(ANTHROPIC_API_KEY="sk-test-not-real", ASTRION_LLM_FALLBACK_MODELS=fallbacks)
    return ClaudeProvider(settings, client=FakeClient(results, **kw))


MSGS = [LLMMessage(role="user", content="hello")]


def test_request_shape_has_no_silent_fallback():
    p = provider([_message()])
    result = p.complete(MSGS, system="sys", effort="high")
    call = p._client.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert "fallbacks" not in call and "betas" not in call and "extra_body" not in call
    assert call["thinking"] == {"type": "adaptive"}
    assert call["output_config"] == {"effort": "high"}
    assert result.text == "ok"
    assert result.fallback_used is False
    assert result.execution_fields() == {
        "provider": "anthropic",
        "model_requested": "claude-opus-5-5",
        "model": "claude-opus-5-5",
        "fallback_reason": None,
        "provider_request_id": "req_claude-opus-5-5",
        "input_tokens": 11,
        "output_tokens": 7,
    }


def test_refusal_is_raised_not_swallowed():
    p = provider([_message(stop_reason="refusal", category="cyber")])
    with pytest.raises(ProviderRefusalError) as info:
        p.complete(MSGS)
    assert info.value.category == "cyber"
    assert [a.outcome for a in info.value.attempts] == ["refusal"]
    assert len(p._client.calls) == 1  # no hidden retry on another model


def test_explicit_fallback_is_recorded():
    p = provider([_message(stop_reason="refusal", category="bio"), _message(model="claude-opus-4-8", text="fallback answer")], fallbacks="claude-opus-4-8")
    result = p.complete(MSGS)
    assert [c["model"] for c in p._client.calls] == ["claude-opus-5-5", "claude-opus-4-8"]
    assert result.fallback_used is True
    assert result.model_requested == "claude-opus-5-5" and result.model_served == "claude-opus-4-8"
    assert result.fallback_reason == "refusal by claude-opus-5-5 (bio)"
    assert [(a.model, a.outcome) for a in result.attempts] == [("claude-opus-5-5", "refusal"), ("claude-opus-4-8", "completed")]


def test_fallback_not_used_for_errors():
    """Errors are not refusals: they propagate instead of silently switching models."""
    p = provider([_status_error(anthropic.RateLimitError, 429, "rate_limit_error")], fallbacks="claude-opus-4-8")
    with pytest.raises(ProviderRateLimitError) as info:
        p.complete(MSGS)
    assert len(p._client.calls) == 1
    assert info.value.retryable is True


@pytest.mark.parametrize(
    ("cls", "status", "etype", "expected"),
    [
        (anthropic.AuthenticationError, 401, "authentication_error", ProviderAuthError),
        (anthropic.NotFoundError, 404, "not_found_error", ProviderModelNotFoundError),
        (anthropic.RateLimitError, 429, "rate_limit_error", ProviderRateLimitError),
        (anthropic.InternalServerError, 500, "api_error", ProviderUnavailableError),
    ],
)
def test_provider_errors_are_preserved(cls, status, etype, expected):
    original = _status_error(cls, status, etype)
    p = provider([original])
    with pytest.raises(expected) as info:
        p.complete(MSGS)
    err = info.value
    assert err.status_code == status
    assert err.error_type == etype
    assert err.model == "claude-opus-5-5"
    assert err.__cause__ is original  # the SDK exception is kept for diagnostics


def test_verify_model():
    p = provider([], model_ids=("claude-opus-5-5",))
    ok = p.verify_model()
    assert ok.supported and ok.model == "claude-opus-5-5"
    missing = p.verify_model("claude-made-up-9")
    assert missing.supported is False


def test_fallback_list_excludes_primary():
    p = provider([], fallbacks="claude-opus-5-5, claude-opus-4-8")
    assert p.fallback_models == ["claude-opus-4-8"]
