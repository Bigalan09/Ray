def test_models_returns_list(client):
    resp = client.get("/api/models")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert "id" in data[0]
    assert "model" in data[0]


def test_models_contain_default(client):
    resp = client.get("/api/models")
    data = resp.json()
    ids = [m["id"] for m in data]
    assert "gpt-4.1" in ids
