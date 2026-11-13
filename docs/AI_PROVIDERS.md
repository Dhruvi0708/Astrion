# AI Provider Configuration

Investigation agents call Claude through `app/intelligence/llm.py` (`ClaudeStructuredLLM`). Every call is a structured-output request validated against the agent's contract. Provider, served model, request id, tokens and estimated cost are recorded per execution. See [INTELLIGENCE_ENGINE.md](INTELLIGENCE_ENGINE.md).

## Providers for investigations

| `ASTRION_LLM_PROVIDER` | Behaviour |
|---|---|
| `anthropic` (default) | Uses `ANTHROPIC_API_KEY`. Without a key, `/intelligence/status` reports `configured: false` and `start` returns 503 `llm_unavailable`. Nothing is faked. |
| `fixture` | Deterministic keyword rules (`app/intelligence/fixture.py`) for offline development, tests and e2e. Rejected unless `ASTRION_ENVIRONMENT` is `development` or `test`. Results are recorded as provider `fixture` and labelled "not AI" in the UI and reports. |

Structured outputs: `output_config.format = {type: "json_schema", schema}` with a strict schema generated from the Pydantic contract (`strict_json_schema`: every object closed and all fields required). The output is re-validated with Pydantic; a mismatch is a retryable `SchemaValidationError`. `stop_reason` `refusal` → `ProviderRefusalError`; `max_tokens` → retryable `ProviderUnavailableError`.

The Phase 1.5 provider layer below is reused for error translation.

## Claude (`app/ai/llm.py`)

```
ANTHROPIC_API_KEY=...                      # server-side only
ASTRION_LLM_MODEL=claude-opus-5-5          # the model that runs
ASTRION_LLM_FALLBACK_MODELS=               # optional, comma-separated, explicit
```

Requests use the official Anthropic SDK with streaming, adaptive thinking and an explicit `effort`.

### Integrity rules
| Rule | How |
|---|---|
| No silent fallback | ASTRION never sends Anthropic's server-side `fallbacks` parameter (Phase 1 did — removed). The configured model is the model that answers. |
| Explicit, auditable fallback | Only if `ASTRION_LLM_FALLBACK_MODELS` is set, only after a **refusal** (never for errors), and every attempt is recorded in `LLMResult.attempts` with `fallback_used` and `fallback_reason`. |
| Refusals preserved | `stop_reason == "refusal"` raises `ProviderRefusalError` with the refusal `category`, `explanation` and attempts — never empty text. |
| Errors preserved | SDK errors become typed `ProviderAuthError`, `ProviderPermissionError`, `ProviderModelNotFoundError`, `ProviderBadRequestError`, `ProviderRateLimitError` (retryable), `ProviderUnavailableError` (retryable), keeping HTTP status, error type, request id and the original exception as `__cause__`. |
| Identity recorded | `LLMResult` carries `provider`, `model_requested`, `model_served`, `request_id`, token usage. `execution_fields()` maps them onto `agent_executions` (`provider`, `model_requested`, `model`, `fallback_reason`, `provider_request_id`, tokens — columns added in migration 0002). |
| Model verification | `ClaudeProvider.verify_model()` checks the id via the Models API (no tokens billed). CLI: `python -m app.ai.check` (exit code 0 = all configured models available). |

### Verification status
Unit-tested with a fake SDK client (`tests/test_llm_provider.py`, `tests/test_intelligence_units.py`). The model id has **not** been verified against Anthropic's live API in this environment because no API key was available; run `python -m app.ai.check` once `ANTHROPIC_API_KEY` is set.

## Embeddings (`app/ai/embeddings.py`)
Voyage AI over HTTPS (`VOYAGE_API_KEY`, `ASTRION_EMBEDDING_MODEL=voyage-3.5`). Unconfigured providers raise `ProviderNotConfiguredError` explicitly.
