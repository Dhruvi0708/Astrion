"""LLM provider abstraction with auditable identity and no silent fallback.

Integrity rules
* The configured model is the model that runs. ASTRION never sends Anthropic's server-side
  ``fallbacks`` parameter, so a different model can't silently answer.
* A fallback happens only if ``ASTRION_LLM_FALLBACK_MODELS`` is set explicitly, only after a
  refusal, and every attempt is recorded in ``LLMResult.attempts`` with the reason.
* Provider errors and refusals are surfaced as typed ``ProviderError`` subclasses that keep the
  HTTP status, error type, request id and the original SDK exception (``__cause__``).
* Credentials are read from server-side settings only.

Nothing in Phase 1.5 calls ``complete``; agents and extraction arrive later.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Protocol

from app.core.config import Settings, get_settings

PROVIDER_ANTHROPIC = "anthropic"


# --------------------------------------------------------------------------- errors


class ProviderError(RuntimeError):
    """Base class. ``retryable`` tells callers whether trying again later can succeed."""

    retryable = False

    def __init__(
        self,
        message: str,
        *,
        provider: str,
        model: str | None = None,
        status_code: int | None = None,
        error_type: str | None = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.model = model
        self.status_code = status_code
        self.error_type = error_type
        self.request_id = request_id


class ProviderNotConfiguredError(ProviderError):
    def __init__(self, message: str) -> None:
        super().__init__(message, provider="none")


class ProviderAuthError(ProviderError):
    pass


class ProviderPermissionError(ProviderError):
    pass


class ProviderModelNotFoundError(ProviderError):
    pass


class ProviderBadRequestError(ProviderError):
    pass


class ProviderRateLimitError(ProviderError):
    retryable = True


class ProviderUnavailableError(ProviderError):
    retryable = True


class ProviderRefusalError(ProviderError):
    """The model declined (``stop_reason == "refusal"``). Never converted into empty output."""

    def __init__(self, message: str, *, category: str | None, explanation: str | None, attempts: list["Attempt"], **kw: Any) -> None:
        super().__init__(message, **kw)
        self.category = category
        self.explanation = explanation
        self.attempts = attempts


# --------------------------------------------------------------------------- results


@dataclass(frozen=True)
class LLMMessage:
    role: str  # "user" | "assistant"
    content: str


@dataclass(frozen=True)
class Attempt:
    model: str
    outcome: str  # "completed" | "refusal"
    request_id: str | None
    refusal_category: str | None = None


@dataclass(frozen=True)
class LLMResult:
    text: str
    provider: str
    model_requested: str  # the configured primary model
    model_served: str  # the model the API reports actually produced the response
    stop_reason: str | None
    input_tokens: int
    output_tokens: int
    request_id: str | None
    fallback_used: bool = False
    fallback_reason: str | None = None
    attempts: list[Attempt] = field(default_factory=list)
    completed_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def execution_fields(self) -> dict[str, Any]:
        """Columns for an ``agent_executions`` row, so every run records who answered."""
        return {
            "provider": self.provider,
            "model_requested": self.model_requested,
            "model": self.model_served,
            "fallback_reason": self.fallback_reason,
            "provider_request_id": self.request_id,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
        }


@dataclass(frozen=True)
class ModelCheck:
    model: str
    supported: bool
    display_name: str | None = None
    detail: str | None = None


class LLMProvider(Protocol):
    name: str

    @property
    def configured(self) -> bool: ...

    def complete(self, messages: list[LLMMessage], *, system: str | None = None, max_tokens: int = 16000, effort: str = "medium") -> LLMResult: ...

    def verify_model(self, model: str | None = None) -> ModelCheck: ...


class NullLLMProvider:
    name = "none"
    configured = False

    def complete(self, messages: list[LLMMessage], *, system: str | None = None, max_tokens: int = 16000, effort: str = "medium") -> LLMResult:
        raise ProviderNotConfiguredError("No LLM provider is configured. Set ANTHROPIC_API_KEY on the server.")

    def verify_model(self, model: str | None = None) -> ModelCheck:
        return ModelCheck(model=model or "", supported=False, detail="No LLM provider is configured.")


# --------------------------------------------------------------------------- Claude


class ClaudeProvider:
    """Claude via the official Anthropic SDK: adaptive thinking, explicit effort, streaming."""

    name = PROVIDER_ANTHROPIC

    def __init__(self, settings: Settings, client: Any | None = None) -> None:
        import anthropic

        self._anthropic = anthropic
        if client is None:
            key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
            client = anthropic.Anthropic(api_key=key, max_retries=2)
        self._client = client
        self.model = settings.llm_model
        self.fallback_models = [m for m in settings.llm_fallback_models if m != settings.llm_model]

    @property
    def configured(self) -> bool:
        return True

    def _translate(self, exc: Exception, model: str) -> ProviderError:
        a = self._anthropic
        status = getattr(exc, "status_code", None)
        body = getattr(exc, "body", None)
        error_type = body.get("error", {}).get("type") if isinstance(body, dict) else None
        request_id = getattr(exc, "request_id", None)
        kw = {"provider": self.name, "model": model, "status_code": status, "error_type": error_type, "request_id": request_id}
        message = getattr(exc, "message", None) or str(exc)
        # Most specific first; order matters because these share a base class.
        if isinstance(exc, a.AuthenticationError):
            return ProviderAuthError(message, **kw)
        if isinstance(exc, a.PermissionDeniedError):
            return ProviderPermissionError(message, **kw)
        if isinstance(exc, a.NotFoundError):
            return ProviderModelNotFoundError(message, **kw)
        if isinstance(exc, a.RateLimitError):
            return ProviderRateLimitError(message, **kw)
        if isinstance(exc, a.BadRequestError):
            return ProviderBadRequestError(message, **kw)
        if isinstance(exc, a.APIStatusError):
            return (ProviderUnavailableError if (status or 0) >= 500 else ProviderBadRequestError)(message, **kw)
        if isinstance(exc, (a.APIConnectionError, a.APITimeoutError)):
            return ProviderUnavailableError(message, **kw)
        return ProviderError(message, **kw)

    def _call(self, model: str, messages: list[LLMMessage], system: str | None, max_tokens: int, effort: str) -> Any:
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort},
        }
        if system:
            kwargs["system"] = system
        # Deliberately NOT passing `fallbacks`: server-side fallback would let another model answer
        # without ASTRION choosing or recording it. Fallback is handled explicitly below.
        try:
            with self._client.messages.stream(**kwargs) as stream:  # stream: no HTTP timeouts on long outputs
                return stream.get_final_message()
        except self._anthropic.APIError as exc:
            raise self._translate(exc, model) from exc

    def complete(self, messages: list[LLMMessage], *, system: str | None = None, max_tokens: int = 16000, effort: str = "medium") -> LLMResult:
        attempts: list[Attempt] = []
        chain = [self.model, *self.fallback_models]
        for index, model in enumerate(chain):
            message = self._call(model, messages, system, max_tokens, effort)
            request_id = getattr(message, "_request_id", None)
            if message.stop_reason == "refusal":
                details = getattr(message, "stop_details", None)
                category = getattr(details, "category", None)
                attempts.append(Attempt(model=model, outcome="refusal", request_id=request_id, refusal_category=category))
                if index + 1 < len(chain):
                    continue  # explicit, configured fallback — recorded, never silent
                raise ProviderRefusalError(
                    "The model declined this request.",
                    category=category,
                    explanation=getattr(details, "explanation", None),
                    attempts=attempts,
                    provider=self.name,
                    model=model,
                    request_id=request_id,
                )
            attempts.append(Attempt(model=model, outcome="completed", request_id=request_id))
            text = "".join(block.text for block in message.content if block.type == "text")
            used_fallback = index > 0
            return LLMResult(
                text=text,
                provider=self.name,
                model_requested=self.model,
                model_served=message.model,
                stop_reason=message.stop_reason,
                input_tokens=message.usage.input_tokens,
                output_tokens=message.usage.output_tokens,
                request_id=request_id,
                fallback_used=used_fallback,
                fallback_reason=f"refusal by {chain[index - 1]} ({attempts[-2].refusal_category or 'uncategorised'})" if used_fallback else None,
                attempts=attempts,
            )
        raise AssertionError("unreachable")  # pragma: no cover

    def verify_model(self, model: str | None = None) -> ModelCheck:
        """Confirms the model id is served to this account via the Models API (no tokens billed)."""
        target = model or self.model
        try:
            info = self._client.models.retrieve(target)
        except self._anthropic.NotFoundError:
            return ModelCheck(model=target, supported=False, detail="Model not found for this API key.")
        except self._anthropic.APIError as exc:
            raise self._translate(exc, target) from exc
        return ModelCheck(model=info.id, supported=info.id == target, display_name=getattr(info, "display_name", None))


@lru_cache
def get_llm_provider() -> LLMProvider:
    settings = get_settings()
    if settings.anthropic_api_key and settings.anthropic_api_key.get_secret_value():
        return ClaudeProvider(settings)
    return NullLLMProvider()
