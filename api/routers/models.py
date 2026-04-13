from __future__ import annotations

from fastapi import APIRouter

from config import load_yaml

router = APIRouter()


@router.get("/models")
async def list_models():
    """Return available models from all configured providers."""
    config = load_yaml("models.yaml")
    providers = config.get("providers", {})
    default_model = config.get("default_model", "")
    models = []

    for _provider_name, provider in providers.items():
        provider_type = provider.get("type", "")

        if provider_type == "openai":
            for model in provider.get("models", []):
                models.append({"id": model["id"], "model": model.get("name", model["id"])})

        elif provider_type == "azure_openai":
            for dep in provider.get("deployments", []):
                models.append({"id": dep["id"], "model": dep.get("name", dep["id"])})

        elif provider_type == "ollama":
            for m in provider.get("models", []):
                models.append({"id": m["id"], "model": m.get("name", m["id"])})

    # Place the configured default model first so clients pick it up naturally.
    if default_model:
        models.sort(key=lambda m: m["id"] != default_model)

    return models
