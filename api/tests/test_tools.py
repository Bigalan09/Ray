def test_tools_returns_list(client):
    resp = client.get("/api/tools")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_tools_have_required_fields(client):
    resp = client.get("/api/tools")
    data = resp.json()
    for tool in data:
        assert "name" in tool
        assert "description" in tool
        assert "parameters" in tool


def test_calculator_tool_works(client):
    resp = client.post("/api/tools/execute", json={
        "tool_name": "calculator",
        "arguments": {"expression": "2 + 3 * 4"},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"] == 14.0


def test_current_time_tool_works(client):
    resp = client.post("/api/tools/execute", json={
        "tool_name": "get_current_time",
        "arguments": {},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "datetime" in data
    assert "timezone" in data


def test_unknown_tool_returns_error(client):
    resp = client.post("/api/tools/execute", json={
        "tool_name": "nonexistent",
        "arguments": {},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data
