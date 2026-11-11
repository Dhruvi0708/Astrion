"""LLM provider abstraction.

Phase 1 establishes the interface and a Claude implementation; nothing in the API calls it yet.
Credentials come only from server-side environment variables and are never exposed to clients.
"""

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Protocol

from app.core.config import Settings, get_settings


class ProviderNotConfiguredError(RuntimeError):
    pass


class ProviderRefusalError(RuntimeError):
    """The model declined the request (stop_reason == "refusal")."""


@dataclass(frozen=True)
class LLMMessage:
    role: str  # "user" | "assistant"
    content: str


@dataclass(frozen=True)
class LLMResult:
    text: str
    model: str
    stop_reason: str | None
    input_tokens: int
    output_tokens: int
    raw_ids: dict[str, str] = field(default_factory=dict)


class LLMProvider(Protocol):
    name: str

    @property
    def configured(self) -> bool: ...

    def complete(self, messages: list[LLMMessage], *, system: str | None = None, max_tokens: int = 16000, effort: str = "medium") -> LLMResult: ...


class NullLLMProvider:
    name = "none"
    configured = False

    def complete(self, messages: list[LLMMessage], *, system: str | None = None, max_tokens: int = 16000, effort: str = "medium") -> LLMResult:
        raise ProviderNotConfiguredError("No LLM provider is configured. Set ANTHROPIC_API_KEY on the server.")


class ClaudeProvider:
    """Claude via the official Anthropic SDK (adaptive thinking; effort controls depth)."""

    name = "anthropic"

    def __init__(self, settings: Settings) -> None:
        import anthropic

        self._anthropic = anthropic
        key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
        self._client = anthropic.Anthropic(api_key=key, max_retries=2)
        self.model = settings.llm_model

    @property
    def configured(self) -> bool:
        return True

    def complete(self, messages: list[LLMMessage], *, system: str | None = None, max_tokens: int = 16000, effort: str = "medium") -> LLMResult:
        kwargs: dict = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort},
        }
        if system:
            kwargs["system"] = system
        # Server-side fallback: if a safety classifier declines, the API re-runs the request on
        # Anthropic's recommended fallback model instead of returning a refusal.
        kwargs["betas"] = ["server-side-fallback-2026-07-01"]
        kwargs["fallbacks"] = "default"
        # Stream so long generations never hit HTTP timeouts; collect the final message.
        with self._client.beta.messages.stream(**kwargs) as stream:
            message = stream.get_final_message()
        if message.stop_reason == "refusal":
            raise ProviderRefusalError("The model declined this request.")
        text = "".join(block.text for block in message.content if block.type == "text")
        return LLMResult(
            text=text,
            model=message.model,
            stop_reason=message.stop_reason,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            raw_ids={"message_id": message.id},
        )


@lru_cache
def get_llm_provider() -> LLMProvider:
    settings = get_settings()
    if settings.anthropic_api_key and settings.anthropic_api_key.get_secret_value():
        return ClaudeProvider(settings)
    return NullLLMProvider()
