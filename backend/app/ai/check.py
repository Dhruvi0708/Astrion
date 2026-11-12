"""Verify the configured LLM model against the provider:  python -m app.ai.check

Calls the Models API only (no tokens are generated or billed). Exits non-zero when the model is
not available to the configured key, so it can gate deployments.
"""

import sys

from app.ai.llm import ProviderError, get_llm_provider
from app.core.config import get_settings


def main() -> int:
    settings = get_settings()
    provider = get_llm_provider()
    if not provider.configured:
        print("LLM provider not configured (ANTHROPIC_API_KEY is unset).")
        return 2
    models = [settings.llm_model, *settings.llm_fallback_models]
    ok = True
    for model in models:
        try:
            check = provider.verify_model(model)
        except ProviderError as exc:
            print(f"{model}: ERROR {type(exc).__name__} (status={exc.status_code}, request_id={exc.request_id})")
            ok = False
            continue
        print(f"{model}: {'supported' if check.supported else 'NOT supported'} {check.display_name or check.detail or ''}".rstrip())
        ok &= check.supported
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
