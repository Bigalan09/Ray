def test_mcp_status_endpoint(client):
    resp = client.get("/api/mcp/status")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


def test_mcp_tool_execution_unknown_tool(client):
    """MCP tools that don't exist should return an error via the tool registry."""
    resp = client.post("/api/tools/execute", json={
        "tool_name": "mcp__fake__tool",
        "arguments": {},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data
