"""Structured LLM calls for agents.

Every agent call goes through ``StructuredLLM.generate``: the provider returns JSON constrained by a JSON
schema derived from the agent's Pydantic output contract, and the result is validated again with
Pydantic before any agent logic sees it. Provider, model, request id, tokens and estimated cost are
returned with every result so executions are auditable.

Implementations
* ``ClaudeStructuredLLM`` — real model calls through the Anthropic SDK (no server-side fallback).
* ``FixtureLLM`` (``app.intelligence.fixture``) — deterministic, rule-based outputs for tests and offline
  demos. Its results are always labelled ``provider="fixture"`` and are never presented as AI output.
"""

import copy
import json
import time
from dataclasses import dataclass
from typing import Any, Generic, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from app.ai.llm import (
    PROVIDER_ANTHROPIC,
    ProviderBadRequestError,
    ProviderError,
    ProviderRefusalError,
    ProviderUnavailableError,
)
from app.core.config import Settings

T = TypeVar("T", bound=BaseModel)

# Published per-million-token prices (USD) used for *estimated* cost. Unknown models report no cost.
PRICING_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-fable-5-2": (8.0, 40.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}


def estimate_cost(model: str | None, input_tokens: int, output_tokens: int) -> float | None:
    price = PRICING_PER_MTOK.get(model or "")
    if price is None:
        return None
    return round((input_tokens * price[0] + output_tokens * price[1]) / 1_000_000, 6)


class SchemaValidationError(ProviderError):
    """The model's output did not match the agent's output contract. Retryable once."""

    retryable = True


@dataclass(frozen=True)
class StructuredResult(Generic[T]):
    output: T
    provider: str
    model_requested: str
    model_served: str
    request_id: str | None
    input_tokens: int
    output_tokens: int
    cost_usd: float | None
    duration_ms: int


class StructuredLLM(Protocol):
    provider: str
    model: str

    def generate(
        self, *, agent: str, system: str, prompt: str, output_type: type[T], payload: BaseModel, max_tokens: int = 16000, effort: str = "medium"
    ) -> StructuredResult[T]: ...


# --------------------------------------------------------------------------- schema conversion

_UNSUPPORTED = {
    "title",
    "default",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "examples",
}


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Converts a Pydantic model schema into the strict subset accepted by structured outputs:
    every object closed (``additionalProperties: false``) with all properties required, and
    validation keywords removed (they're enforced afterwards by Pydantic instead)."""
    schema = copy.deepcopy(model.model_json_schema())

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            for key in list(node):
                if key in _UNSUPPORTED:
                    node.pop(key)
            if node.get("type") == "object" or "properties" in node:
                props = node.get("properties", {})
                node["required"] = list(props)
                node["additionalProperties"] = False
                for prop in props.values():  # property names (e.g. a field called "title") are not keywords
                    walk(prop)
            for key, value in node.items():
                if key != "properties":
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)
        return node

    return walk(schema)


# --------------------------------------------------------------------------- Claude


class ClaudeStructuredLLM:
    provider = PROVIDER_ANTHROPIC

    def __init__(self, settings: Settings, client: Any | None = None, timeout_seconds: float = 300.0) -> None:
        import anthropic

        self._anthropic = anthropic
        if client is None:
            key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
            # Retries are handled by the orchestrator (recorded per attempt), not hidden in the SDK.
            client = anthropic.Anthropic(api_key=key, max_retries=0, timeout=timeout_seconds)
        self._client = client
        self.model = settings.llm_model
        from app.ai.llm import ClaudeProvider

        self._translator = ClaudeProvider(settings, client=client)

    def generate(
        self, *, agent: str, system: str, prompt: str, output_type: type[T], payload: BaseModel, max_tokens: int = 16000, effort: str = "medium"
    ) -> StructuredResult[T]:
        started = time.perf_counter()
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": strict_json_schema(output_type)}},
            "metadata": {"user_id": f"astrion-agent-{agent}"},
        }
        try:
            with self._client.messages.stream(**kwargs) as stream:
                message = stream.get_final_message()
        except self._anthropic.APIError as exc:
            raise self._translator._translate(exc, self.model) from exc
        request_id = getattr(message, "_request_id", None)
        if message.stop_reason == "refusal":
            details = getattr(message, "stop_details", None)
            raise ProviderRefusalError(
                f"The model declined the {agent} task.",
                category=getattr(details, "category", None),
                explanation=getattr(details, "explanation", None),
                attempts=[],
                provider=self.provider,
                model=self.model,
                request_id=request_id,
            )
        if message.stop_reason == "max_tokens":
            raise ProviderUnavailableError(f"The {agent} output was truncated (max_tokens).", provider=self.provider, model=self.model, request_id=request_id)
        text = "".join(block.text for block in message.content if block.type == "text")
        try:
            output = output_type.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValidationError) as exc:
            raise SchemaValidationError(
                f"{agent} output failed schema validation: {exc}", provider=self.provider, model=self.model, request_id=request_id
            ) from exc
        usage = message.usage
        return StructuredResult(
            output=output,
            provider=self.provider,
            model_requested=self.model,
            model_served=message.model,
            request_id=request_id,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cost_usd=estimate_cost(message.model, usage.input_tokens, usage.output_tokens),
            duration_ms=int((time.perf_counter() - started) * 1000),
        )


def get_structured_llm(settings: Settings) -> StructuredLLM | None:
    """Returns the configured provider, or None when no provider is available.

    ``ASTRION_LLM_PROVIDER=fixture`` selects the deterministic fixture provider; it's refused outside
    development and test so a production deployment can never serve fixture output.
    """
    if settings.llm_provider == "fixture":
        if settings.environment not in ("development", "test"):
            raise ProviderBadRequestError("The fixture LLM provider is only allowed in development and test.", provider="fixture")
        from app.intelligence.fixture import FixtureLLM

        return FixtureLLM()
    if settings.anthropic_api_key and settings.anthropic_api_key.get_secret_value():
        return ClaudeStructuredLLM(settings)
    return None
