import React, { useState, useEffect } from "react";

interface MCPServer {
  name: string;
  enabled: boolean;
  running: boolean;
  tool_count: number;
  command: string;
}

interface MCPPanelProps {
  visible: boolean;
  onClose: () => void;
}

const EMPTY_FORM = { name: "", command: "", args: "" };

export function MCPPanel({ visible, onClose }: MCPPanelProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) loadServers();
  }, [visible]);

  const loadServers = async () => {
    try {
      const resp = await fetch("/api/mcp/status");
      setServers(await resp.json());
    } catch (err) {
      console.error("Failed to load MCP status:", err);
    }
  };

  const handleAdd = async () => {
    setError(null);
    if (!form.name.trim() || !form.command.trim()) {
      setError("Name and command are required.");
      return;
    }
    setSaving(true);
    try {
      const args = form.args.trim()
        ? form.args.trim().split(/\s+/)
        : [];
      const resp = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), command: form.command.trim(), args }),
      });
      const data = await resp.json();
      if (data.error) {
        setError(data.error);
      } else {
        setForm(EMPTY_FORM);
        setShowForm(false);
        await loadServers();
      }
    } catch {
      setError("Failed to add server.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    const resp = await fetch(`/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (resp.ok) await loadServers();
  };

  const handleRemove = async (name: string) => {
    const resp = await fetch(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (resp.ok) await loadServers();
  };

  const handleRestart = async (name: string) => {
    await fetch(`/api/mcp/servers/${encodeURIComponent(name)}/restart`, { method: "POST" });
    await loadServers();
  };

  if (!visible) return null;

  return (
    <div className="fixed top-10 left-0 right-0 bottom-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-96 bg-[var(--bg-deeper)] border-l border-[var(--border)] flex flex-col h-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
          <span className="font-semibold text-gray-200">MCP Servers</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white rounded-lg p-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {servers.length === 0 && !showForm && (
            <div className="text-gray-500 text-sm p-4 text-center">
              No MCP servers configured.
              <br />
              <button
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
                onClick={() => setShowForm(true)}
              >
                Add your first server
              </button>
            </div>
          )}

          {servers.map((server) => (
            <div key={server.name} className="border border-[var(--border)] rounded-lg p-3 mb-2 bg-[var(--bg-surface)]">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-gray-200">{server.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  server.running
                    ? "bg-green-600/20 text-green-400"
                    : server.enabled
                    ? "bg-yellow-600/20 text-yellow-400"
                    : "bg-gray-600/20 text-gray-500"
                }`}>
                  {server.running ? "Running" : server.enabled ? "Stopped" : "Disabled"}
                </span>
              </div>
              <div className="text-xs text-gray-500 mb-2">{server.command}</div>
              {server.running && (
                <div className="text-xs text-gray-400 mb-2">
                  {server.tool_count} tool{server.tool_count !== 1 ? "s" : ""} available
                </div>
              )}
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => handleToggle(server.name, !server.enabled)}
                  className="text-xs px-2 py-1 rounded bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 transition-colors"
                >
                  {server.enabled ? "Disable" : "Enable"}
                </button>
                {server.enabled && (
                  <button
                    onClick={() => handleRestart(server.name)}
                    className="text-xs px-2 py-1 rounded bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 transition-colors"
                  >
                    Restart
                  </button>
                )}
                <button
                  onClick={() => handleRemove(server.name)}
                  className="text-xs px-2 py-1 rounded bg-red-900/30 hover:bg-red-800/40 text-red-400 transition-colors ml-auto"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {showForm && (
            <div className="border border-blue-600/30 rounded-lg p-3 mb-2 bg-[var(--bg-surface)]">
              <div className="text-sm font-medium text-gray-200 mb-2">Add MCP Server</div>
              {error && <div className="text-xs text-red-400 mb-2">{error}</div>}
              <input
                className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 mb-2 focus:outline-none focus:border-blue-500"
                placeholder="Server name (e.g. filesystem)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 mb-2 focus:outline-none focus:border-blue-500"
                placeholder="Command (e.g. npx)"
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
              />
              <input
                className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 mb-3 focus:outline-none focus:border-blue-500"
                placeholder="Args (space-separated, e.g. -y @modelcontextprotocol/server-filesystem /tmp)"
                value={form.args}
                onChange={(e) => setForm({ ...form, args: e.target.value })}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded py-1.5 transition-colors"
                >
                  {saving ? "Adding…" : "Add Server"}
                </button>
                <button
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setError(null); }}
                  className="text-xs px-3 bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-2 border-t border-[var(--border)] flex gap-2">
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setError(null); }}
              className="flex-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg py-2 transition-colors"
            >
              + Add Server
            </button>
          )}
          <button
            onClick={loadServers}
            className="flex-1 text-xs bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 rounded-lg py-2 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
