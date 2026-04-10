from llm.providers import (
    resolve_model_provider,
    OpenAIResponsesProvider,
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
