def test_get_soul(client):
    resp = client.get("/api/identity/soul")
    assert resp.status_code == 200
    data = resp.json()
    assert "content" in data
    assert len(data["content"]) > 0


def test_get_me(client):
    resp = client.get("/api/identity/me")
    assert resp.status_code == 200
    data = resp.json()
    assert "content" in data
    assert len(data["content"]) > 0
