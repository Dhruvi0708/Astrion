# AI Provider Configuration

No feature calls an AI provider yet (agents and extraction arrive in later phases). Phase 1.5 hardens the provider layer so future calls are auditable.

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
Unit-tested with a fake SDK client (`tests/test_llm_provider.py`). The model id has **not** been verified against Anthropic's live API in this environment because no API key was available; run `python -m app.ai.check` once `ANTHROPIC_API_KEY` is set.

## Embeddings (`app/ai/embeddings.py`)
Voyage AI over HTTPS (`VOYAGE_API_KEY`, `ASTRION_EMBEDDING_MODEL=voyage-3.5`). Unconfigured providers raise `ProviderNotConfiguredError` explicitly.
