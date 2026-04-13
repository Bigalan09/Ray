from llm.providers import (
    resolve_model_provider,
    get_provider,
    OpenAIResponsesProvider,
    AzureOpenAIProvider,
    OllamaProvider,
)


def test_resolve_openai_model():
    provider, model_id = resolve_model_provider("gpt-5-nano")
    assert isinstance(provider, OpenAIResponsesProvider)
    assert model_id == "gpt-5-nano"


def test_resolve_unknown_model_falls_back_to_openai():
    provider, model_id = resolve_model_provider("some-unknown-model")
    assert isinstance(provider, OpenAIResponsesProvider)


def test_openai_provider_builds_url():
    provider = OpenAIResponsesProvider(
        api_key="test",
        base_url="https://api.openai.com/v1",
    )
    url = provider.build_url("gpt-5-nano")
    assert url == "https://api.openai.com/v1/responses"


def test_ollama_provider_builds_url():
    provider = OllamaProvider(base_url="http://localhost:11434")
    url = provider.build_url("llama3")
    assert "localhost:11434" in url


# --- Azure OpenAI provider ---


def test_resolve_azure_model():
    """Azure deployment IDs should resolve to AzureOpenAIProvider."""
    provider, model_id = resolve_model_provider("gpt-5-mini")
    assert isinstance(provider, AzureOpenAIProvider)
    assert model_id == "gpt-5-mini"


def test_azure_provider_builds_url():
    provider = AzureOpenAIProvider(
        endpoint="https://my-resource.openai.azure.com",
        api_key="test",
        api_version="2024-05-01-preview",
    )
    url = provider.build_url("gpt-5-mini")
    assert url == (
        "https://my-resource.openai.azure.com/openai/deployments/"
        "gpt-5-mini/chat/completions?api-version=2024-05-01-preview"
    )


def test_azure_provider_strips_trailing_slash():
    provider = AzureOpenAIProvider(
        endpoint="https://my-resource.openai.azure.com/",
        api_key="test",
        api_version="2024-05-01-preview",
    )
    url = provider.build_url("gpt-5-mini")
    # No double slashes after the scheme
    assert "//" not in url.split("://", 1)[1]


def test_azure_temperature_skipped_when_unsupported():
    caps = {"gpt-5-mini": {"supports_temperature": False}}
    provider = AzureOpenAIProvider(
        endpoint="https://test.openai.azure.com",
        api_key="test",
        api_version="2024-05-01-preview",
        deployment_caps=caps,
    )
    assert not provider._supports_temperature("gpt-5-mini")
    # Unconfigured deployments default to supporting temperature
    assert provider._supports_temperature("gpt-4o")


def test_azure_deployment_caps_from_get_provider():
    """get_provider should wire deployment caps from config."""
    config = {
        "endpoint": "https://test.openai.azure.com",
        "api_key": "test",
        "api_version": "2024-05-01-preview",
        "deployments": [
            {"id": "gpt-5-mini", "supports_temperature": False},
        ],
    }
    provider = get_provider("azure_openai", config)
    assert isinstance(provider, AzureOpenAIProvider)
    assert not provider._supports_temperature("gpt-5-mini")
