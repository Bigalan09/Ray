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

export function MCPPanel({ visible, onClose }: MCPPanelProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);

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
          {servers.length === 0 && (
            <div className="text-gray-500 text-sm p-4 text-center">
              No MCP servers configured.
              <br />
              <span className="text-xs">Edit data/mcp_servers.json to add servers.</span>
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
              <div className="text-xs text-gray-500">{server.command}</div>
              {server.running && (
                <div className="text-xs text-gray-400 mt-1">
                  {server.tool_count} tool{server.tool_count !== 1 ? "s" : ""} available
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-2 border-t border-[var(--border)]">
          <button
            onClick={loadServers}
            className="w-full text-xs bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 rounded-lg py-2 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
