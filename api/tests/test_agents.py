def test_list_agents(client):
    resp = client.get("/api/agents")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 3
    names = [a["name"] for a in data]
    assert "general" in names
    assert "orchestrator" in names
    assert "curator" in names


def test_agents_have_display_name(client):
    resp = client.get("/api/agents")
    data = resp.json()
    for agent in data:
        assert "display_name" in agent
        assert "description" in agent


def test_route_research_query(client):
    # All messages now route to general (no sub-agent routing)
    resp = client.post("/api/agents/route", json={
        "message": "search for the latest news about AI",
        "current_agent": "general",
    })
    assert resp.status_code == 200
    assert resp.json()["agent"] == "general"


def test_route_coding_query(client):
    resp = client.post("/api/agents/route", json={
        "message": "write a python function to sort a list",
        "current_agent": "general",
    })
    assert resp.status_code == 200
    assert resp.json()["agent"] == "general"


def test_route_writing_query(client):
    resp = client.post("/api/agents/route", json={
        "message": "draft an email to my manager about the project update",
        "current_agent": "general",
    })
    assert resp.status_code == 200
    assert resp.json()["agent"] == "general"


def test_route_general_stays_current(client):
    resp = client.post("/api/agents/route", json={
        "message": "hello how are you",
        "current_agent": "general",
    })
    assert resp.status_code == 200
    assert resp.json()["agent"] == "general"


def test_route_explicit_agent_overrides(client):
    resp = client.post("/api/agents/route", json={
        "message": "search for news",
        "current_agent": "general",
        "explicit_agent": "orchestrator",
    })
    assert resp.status_code == 200
    assert resp.json()["agent"] == "orchestrator"


def test_route_agent_command(client):
    resp = client.post("/api/agents/route", json={
        "message": "/agent orchestrator",
        "current_agent": "general",
    })
    assert resp.status_code == 200
    assert resp.json()["agent"] == "orchestrator"
