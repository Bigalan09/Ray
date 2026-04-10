def test_prompts_returns_list(client):
    resp = client.get("/api/prompts")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_prompts_have_required_fields(client):
    resp = client.get("/api/prompts")
    data = resp.json()
    for prompt in data:
        assert "title" in prompt
        assert "content" in prompt
        assert "temperature" in prompt


def test_default_prompt_exists(client):
    resp = client.get("/api/prompts")
    data = resp.json()
    titles = [p["title"] for p in data]
    assert "Default" in titles


def test_get_single_prompt(client):
    resp = client.get("/api/prompts/Default")
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Default"


def test_get_missing_prompt_returns_404(client):
    resp = client.get("/api/prompts/NonExistent")
    assert resp.status_code == 404
