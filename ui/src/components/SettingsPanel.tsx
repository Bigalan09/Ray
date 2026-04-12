import React, { useState, useEffect, useRef } from "react";
import { SlidePanel, CloseButton } from "./SlidePanel";

interface LoggingSettings {
  level?: string;
  format?: string;
  enable_llm_logging?: boolean;
  llm_log_inputs?: boolean;
  llm_log_outputs?: boolean;
  slow_request_threshold_ms?: number;
  enable_request_logging?: boolean;
  enable_tool_logging?: boolean;
  enable_metrics?: boolean;
}

interface RateLimitSettings {
  enabled: boolean;
  rpm: number;
  burst: number;
  note: string;
}

interface GuardrailsSettings {
  exec_enabled: boolean;
  exec_default_timeout: number;
  exec_allow: { command: string; args: string[]; description: string }[];
}

interface ModelsSettings {
  default_model: string;
  providers: string[];
}

interface Settings {
  logging: LoggingSettings;
  rate_limit: RateLimitSettings;
  guardrails: GuardrailsSettings;
  models: ModelsSettings;
  workspace_overrides: Record<string, any>;
  writable_keys: string[];
}

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
}

const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

export function SettingsPanel({ visible, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [edits, setEdits] = useState<Partial<LoggingSettings>>({});
  const [saving, setSaving] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) load();
  }, [visible]);

  const load = async () => {
    try {
      const resp = await fetch("/api/settings");
      const data: Settings = await resp.json();
      setSettings(data);
      setEdits({});
    } catch {
      setMessage({ type: "error", text: "Failed to load settings." });
    }
  };

  const hasEdits = Object.keys(edits).length > 0;

  const handleSave = async () => {
    if (!hasEdits) return;
    setSaving(true);
    setMessage(null);
    try {
      const resp = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: { logging: edits } }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        setMessage({ type: "error", text: err.detail ?? "Save failed." });
      } else {
        setMessage({ type: "success", text: "Settings saved." });
        await load();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      resetTimer.current = setTimeout(() => setResetConfirm(false), 3000);
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setResetConfirm(false);
    setSaving(true);
    try {
      await fetch("/api/settings/overrides", { method: "DELETE" });
      setMessage({ type: "success", text: "Overrides reset to defaults." });
      await load();
    } catch {
      setMessage({ type: "error", text: "Failed to reset settings." });
    } finally {
      setSaving(false);
    }
  };

  const logVal = (key: keyof LoggingSettings) =>
    key in edits ? edits[key] : settings?.logging[key];

  return (
    <SlidePanel visible={visible} onClose={onClose}>
      <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
        <span className="font-semibold text-gray-200">Settings</span>
        <CloseButton onClick={onClose} />
      </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
          {!settings ? (
            <div className="text-gray-500 text-sm p-4 text-center">Loading…</div>
          ) : (
            <>
              {message && (
                <div className={`text-xs px-3 py-2 rounded ${
                  message.type === "success"
                    ? "bg-green-900/30 text-green-400"
                    : "bg-red-900/30 text-red-400"
                }`}>
                  {message.text}
                </div>
              )}

              {/* Logging */}
              <Section title="Logging">
                <Field label="Log level">
                  <select
                    className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500"
                    value={(logVal("level") as string) ?? "INFO"}
                    onChange={(e) => setEdits({ ...edits, level: e.target.value })}
                  >
                    {LOG_LEVELS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Slow request threshold (ms)">
                  <input
                    type="number"
                    className="w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500"
                    value={(logVal("slow_request_threshold_ms") as number) ?? 1000}
                    onChange={(e) =>
                      setEdits({ ...edits, slow_request_threshold_ms: parseInt(e.target.value, 10) || 1000 })
                    }
                  />
                </Field>
                <div className="space-y-1.5">
                  {(
                    [
                      ["enable_request_logging", "Request logging"],
                      ["enable_tool_logging", "Tool logging"],
                      ["enable_llm_logging", "LLM logging"],
                      ["llm_log_inputs", "Log LLM inputs"],
                      ["llm_log_outputs", "Log LLM outputs"],
                      ["enable_metrics", "Prometheus metrics"],
                    ] as [keyof LoggingSettings, string][]
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-blue-500"
                        checked={(logVal(key) as boolean) ?? false}
                        onChange={(e) => setEdits({ ...edits, [key]: e.target.checked })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Section>

              {/* Models (read-only) */}
              <Section title="Models" readOnly>
                <InfoRow label="Default model" value={settings.models.default_model} />
                <InfoRow label="Providers" value={settings.models.providers.join(", ") || "—"} />
              </Section>

              {/* Rate limits (read-only) */}
              <Section title="Rate Limits" readOnly>
                <InfoRow label="Enabled" value={settings.rate_limit.enabled ? "Yes" : "No"} />
                <InfoRow label="Requests / min" value={String(settings.rate_limit.rpm)} />
                <InfoRow label="Burst" value={String(settings.rate_limit.burst)} />
                <div className="text-xs text-gray-600 mt-1">{settings.rate_limit.note}</div>
              </Section>

              {/* Guardrails (read-only) */}
              <Section title="Exec Guardrails" readOnly>
                <InfoRow label="Enabled" value={settings.guardrails.exec_enabled ? "Yes" : "No"} />
                <InfoRow
                  label="Default timeout"
                  value={`${settings.guardrails.exec_default_timeout}s`}
                />
                <div className="mt-1 space-y-1">
                  {settings.guardrails.exec_allow.map((rule, i) => (
                    <div key={i} className="text-xs text-gray-400 font-mono bg-[var(--bg-surface)] rounded px-2 py-1">
                      {rule.command} {rule.args.join(" ")}
                      {rule.description && (
                        <span className="ml-2 text-gray-600 font-sans">{rule.description}</span>
                      )}
                    </div>
                  ))}
                  {settings.guardrails.exec_allow.length === 0 && (
                    <div className="text-xs text-gray-600">No commands allowed.</div>
                  )}
                </div>
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        {settings && (
          <div className="p-2 border-t border-[var(--border)] flex gap-2">
            <button
              onClick={handleSave}
              disabled={!hasEdits || saving}
              className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg py-2 transition-colors"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={handleReset}
              disabled={saving}
              className={`flex-1 text-xs rounded-lg py-2 transition-colors ${
                resetConfirm
                  ? "bg-red-700 hover:bg-red-600 text-white"
                  : "bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-400"
              }`}
            >
              {resetConfirm ? "Confirm reset?" : "Reset to defaults"}
            </button>
          </div>
        )}
    </SlidePanel>
  );
}

function Section({
  title,
  readOnly,
  children,
}: {
  title: string;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-[var(--bg-surface)] flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{title}</span>
        {readOnly && (
          <span className="text-xs text-gray-600">read-only</span>
        )}
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 font-mono">{value}</span>
    </div>
  );
}
