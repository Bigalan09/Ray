import React, { useState, useEffect } from "react";

interface Webhook {
  name: string;
  url: string;
  events: string[];
  method: string;
  enabled: boolean;
  source: string;
  secret: string;
}

interface Rule {
  id: string;
  name: string;
  type: "pre" | "post";
  trigger: string;
  handler: string;
  enabled: boolean;
  config: Record<string, any>;
}

interface LogEntry {
  timestamp: string;
  event: string;
  webhook_name: string | null;
  success: boolean;
  status_code: number | null;
  error: string | null;
  duration_ms: number;
}

interface HooksPanelProps {
  visible: boolean;
  onClose: () => void;
}

const ALL_EVENTS = [
  "message_received", "command_executed", "tool_executing", "tool_executed",
  "response_persisted", "exec_approved", "exec_denied", "task_started",
  "task_completed", "task_failed", "session_created", "session_deleted",
];

type RuleForm = { name: string; type: "pre" | "post"; trigger: string; handler: string };
const EMPTY_RULE: RuleForm = { name: "", type: "post", trigger: "*", handler: "log" };

export function HooksPanel({ visible, onClose }: HooksPanelProps) {
  const [tab, setTab] = useState<"webhooks" | "rules">("webhooks");
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [testingName, setTestingName] = useState<string | null>(null);

  // Create webhook form state
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [createError, setCreateError] = useState("");

  // Create rule form state
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE);
  const [ruleError, setRuleError] = useState("");

  useEffect(() => {
    if (visible) {
      loadWebhooks();
      loadRules();
      loadLog();
    }
  }, [visible]);

  const loadWebhooks = async () => {
    try {
      const resp = await fetch("/api/hooks/webhooks");
      setWebhooks(await resp.json());
    } catch {}
  };

  const loadRules = async () => {
    try {
      const resp = await fetch("/api/hooks/rules");
      if (resp.ok) setRules(await resp.json());
    } catch {}
  };

  const loadLog = async () => {
    try {
      const resp = await fetch("/api/hooks/log?limit=20");
      setLogEntries(await resp.json());
    } catch {}
  };

  const handleCreate = async () => {
    setCreateError("");
    if (!newName.trim() || !newUrl.trim()) {
      setCreateError("Name and URL are required.");
      return;
    }
    try {
      const resp = await fetch("/api/hooks/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          url: newUrl.trim(),
          events: newEvents.length > 0 ? newEvents : ALL_EVENTS,
          secret: newSecret,
        }),
      });
      if (resp.ok) {
        setShowCreate(false);
        setNewName("");
        setNewUrl("");
        setNewEvents([]);
        setNewSecret("");
        loadWebhooks();
      }
    } catch {}
  };

  const handleDelete = async (name: string) => {
    await fetch(`/api/hooks/webhooks/${name}`, { method: "DELETE" });
    loadWebhooks();
  };

  const handleTest = async (name: string) => {
    setTestingName(name);
    try {
      await fetch(`/api/hooks/webhooks/${name}/test`, { method: "POST" });
      loadLog();
    } finally {
      setTestingName(null);
    }
  };

  const toggleEvent = (ev: string) => {
    setNewEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  };

  const handleAddRule = async () => {
    setRuleError("");
    if (!ruleForm.trigger.trim()) {
      setRuleError("Trigger pattern is required.");
      return;
    }
    try {
      const resp = await fetch("/api/hooks/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleForm),
      });
      if (resp.ok) {
        setShowRuleForm(false);
        setRuleForm(EMPTY_RULE);
        loadRules();
      } else {
        const err = await resp.json();
        setRuleError(err.detail ?? "Failed to create rule.");
      }
    } catch {
      setRuleError("Failed to create rule.");
    }
  };

  const handleDeleteRule = async (id: string) => {
    await fetch(`/api/hooks/rules/${id}`, { method: "DELETE" });
    loadRules();
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    await fetch(`/api/hooks/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    loadRules();
  };

  if (!visible) return null;

  return (
    <div className="fixed top-10 left-0 right-0 bottom-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-[28rem] bg-[var(--bg-deeper)] border-l border-[var(--border)] flex flex-col h-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
          <div className="flex gap-2">
            <button
              onClick={() => setTab("webhooks")}
              className={`text-sm font-semibold px-1 pb-0.5 border-b-2 transition-colors ${
                tab === "webhooks"
                  ? "border-blue-500 text-gray-200"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              Webhooks
            </button>
            <button
              onClick={() => setTab("rules")}
              className={`text-sm font-semibold px-1 pb-0.5 border-b-2 transition-colors ${
                tab === "rules"
                  ? "border-blue-500 text-gray-200"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              Rules
            </button>
          </div>
          <div className="flex items-center gap-2">
            {tab === "webhooks" && (
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs bg-blue-600/70 hover:bg-blue-500 text-white px-3 py-1 rounded-md transition-colors"
              >
                + New webhook
              </button>
            )}
            {tab === "rules" && (
              <button
                onClick={() => { setShowRuleForm(true); setRuleError(""); }}
                className="text-xs bg-blue-600/70 hover:bg-blue-500 text-white px-3 py-1 rounded-md transition-colors"
              >
                + New rule
              </button>
            )}
            <button
              onClick={() => { loadWebhooks(); loadRules(); loadLog(); }}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded transition-colors"
            >
              Refresh
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Webhooks tab */}
        {tab === "webhooks" && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            {webhooks.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-8">
                No webhooks configured.
              </div>
            )}
            {webhooks.map((wh) => (
              <div key={wh.name} className="bg-[var(--bg-surface)] rounded-lg p-3 mb-2 border border-[var(--border)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-200 truncate">{wh.name}</div>
                    <div className="text-xs text-gray-500 truncate">{wh.url}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-xs text-gray-500">{wh.events.length} events</span>
                    <span className={`w-2 h-2 rounded-full ${wh.enabled ? "bg-green-500" : "bg-gray-600"}`} />
                  </div>
                </div>
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => handleTest(wh.name)}
                    disabled={testingName === wh.name}
                    className="text-xs text-blue-400 hover:text-blue-300 px-2 py-0.5 rounded border border-[var(--border)] transition-colors disabled:opacity-50"
                  >
                    {testingName === wh.name ? "Testing..." : "Test"}
                  </button>
                  {wh.source === "runtime" && (
                    <button
                      onClick={() => handleDelete(wh.name)}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 rounded border border-[var(--border)] transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Recent activity */}
            {logEntries.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-medium text-gray-500 px-1 mb-1">Recent activity</div>
                {logEntries.map((entry, i) => (
                  <div key={i} className="text-xs text-gray-400 px-2 py-1 flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entry.success ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="font-mono truncate">{entry.event}</span>
                    <span className="text-gray-600 ml-auto flex-shrink-0">
                      {entry.status_code && `${entry.status_code} `}{entry.duration_ms}ms
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rules tab */}
        {tab === "rules" && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            <div className="text-xs text-gray-500 px-1 mb-2">
              Pre-hooks can cancel operations. Post-hooks run after completion.
            </div>
            {rules.length === 0 && !showRuleForm && (
              <div className="text-sm text-gray-500 text-center py-8">
                No rules configured.
                <br />
                <button
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
                  onClick={() => { setShowRuleForm(true); setRuleError(""); }}
                >
                  Add first rule
                </button>
              </div>
            )}
            {rules.map((rule) => (
              <div key={rule.id} className="bg-[var(--bg-surface)] rounded-lg p-3 mb-2 border border-[var(--border)]">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                        rule.type === "pre"
                          ? "bg-yellow-800/30 text-yellow-400"
                          : "bg-blue-800/30 text-blue-400"
                      }`}>
                        {rule.type}
                      </span>
                      <span className="text-sm font-medium text-gray-200 truncate">
                        {rule.name || rule.trigger}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 font-mono">{rule.trigger}</div>
                    <div className="text-xs text-gray-600 mt-0.5">handler: {rule.handler}</div>
                  </div>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${rule.enabled ? "bg-green-500" : "bg-gray-600"}`} />
                </div>
                <div className="flex gap-1 mt-2">
                  <button
                    onClick={() => handleToggleRule(rule.id, !rule.enabled)}
                    className="text-xs px-2 py-0.5 rounded border border-[var(--border)] text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 rounded border border-[var(--border)] transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {/* Add rule form */}
            {showRuleForm && (
              <div className="border border-blue-600/30 rounded-lg p-3 mb-2 bg-[var(--bg-surface)]">
                <div className="text-sm font-medium text-gray-200 mb-2">New rule</div>
                {ruleError && <div className="text-xs text-red-400 mb-2">{ruleError}</div>}
                <input
                  className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 mb-2 focus:outline-none focus:border-blue-500"
                  placeholder="Name (optional label)"
                  value={ruleForm.name}
                  onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                />
                <div className="flex gap-2 mb-2">
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-1">Type</div>
                    <select
                      className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500"
                      value={ruleForm.type}
                      onChange={(e) => setRuleForm({ ...ruleForm, type: e.target.value as "pre" | "post" })}
                    >
                      <option value="post">post (after)</option>
                      <option value="pre">pre (before, can cancel)</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-1">Handler</div>
                    <select
                      className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500"
                      value={ruleForm.handler}
                      onChange={(e) => setRuleForm({ ...ruleForm, handler: e.target.value })}
                    >
                      <option value="log">log (to file)</option>
                      <option value="webhook">webhook (HTTP)</option>
                    </select>
                  </div>
                </div>
                <input
                  className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 mb-3 font-mono focus:outline-none focus:border-blue-500"
                  placeholder="Trigger pattern (e.g. command:exec, tool:*, *)"
                  value={ruleForm.trigger}
                  onChange={(e) => setRuleForm({ ...ruleForm, trigger: e.target.value })}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddRule}
                    className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded py-1.5 transition-colors"
                  >
                    Add Rule
                  </button>
                  <button
                    onClick={() => { setShowRuleForm(false); setRuleForm(EMPTY_RULE); setRuleError(""); }}
                    className="text-xs px-3 bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Create webhook modal */}
        {showCreate && (
          <div
            className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
            onClick={() => setShowCreate(false)}
          >
            <div
              className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-[var(--border)]">
                <h3 className="text-sm font-semibold text-gray-200">New webhook</h3>
              </div>
              <div className="p-4 flex flex-col gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Name</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-[var(--bg-input)] text-white rounded-md px-3 py-1.5 text-sm border-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="slack-notify"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">URL</label>
                  <input
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    className="w-full bg-[var(--bg-input)] text-white rounded-md px-3 py-1.5 text-sm border-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://hooks.slack.com/services/..."
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Secret (optional, for HMAC signing)</label>
                  <input
                    value={newSecret}
                    onChange={(e) => setNewSecret(e.target.value)}
                    type="password"
                    className="w-full bg-[var(--bg-input)] text-white rounded-md px-3 py-1.5 text-sm border-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="optional signing secret"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    Events {newEvents.length > 0 ? `(${newEvents.length} selected)` : "(all if none selected)"}
                  </label>
                  <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                    {ALL_EVENTS.map((ev) => (
                      <label key={ev} className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer hover:text-white">
                        <input
                          type="checkbox"
                          checked={newEvents.includes(ev)}
                          onChange={() => toggleEvent(ev)}
                          className="rounded border-gray-600 bg-[var(--bg-input)] text-blue-500 focus:ring-blue-500 w-3 h-3"
                        />
                        {ev}
                      </label>
                    ))}
                  </div>
                </div>
                {createError && (
                  <div className="text-xs text-red-400">{createError}</div>
                )}
              </div>
              <div className="p-4 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
