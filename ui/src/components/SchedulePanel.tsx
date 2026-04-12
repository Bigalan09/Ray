import { SlidePanel, CloseButton } from "./SlidePanel";
import React, { useState, useEffect } from "react";

interface Schedule {
  name: string;
  cron: string;
  prompt: string;
  agent: string;
  enabled: boolean;
  next_run: string | null;
}

interface SchedulePanelProps {
  visible: boolean;
  onClose: () => void;
}

// Frequency presets that map to cron expressions
const FREQUENCIES: { label: string; cron: (time: string) => string }[] = [
  { label: "Every hour", cron: () => "0 * * * *" },
  { label: "Every 15 minutes", cron: () => "*/15 * * * *" },
  { label: "Daily", cron: (t) => `${mins(t)} ${hrs(t)} * * *` },
  { label: "Weekdays", cron: (t) => `${mins(t)} ${hrs(t)} * * 1-5` },
  { label: "Weekly (Monday)", cron: (t) => `${mins(t)} ${hrs(t)} * * 1` },
  { label: "Custom cron", cron: () => "" },
];

function hrs(t: string) { return parseInt(t.split(":")[0] || "9", 10); }
function mins(t: string) { return parseInt(t.split(":")[1] || "0", 10); }

function formatNextRun(iso: string | null): string {
  if (!iso) return "not scheduled";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    if (diff < 0) return "overdue";
    if (diff < 60_000) return "< 1 min";
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function SchedulePanel({ visible, onClose }: SchedulePanelProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [freqIndex, setFreqIndex] = useState(2); // Daily
  const [time, setTime] = useState("09:00");
  const [customCron, setCustomCron] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible) loadSchedules();
  }, [visible]);

  const loadSchedules = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/schedules");
      setSchedules(await resp.json());
    } catch (err) {
      console.error("Failed to load schedules:", err);
    }
    setLoading(false);
  };

  const removeSchedule = async (scheduleName: string) => {
    await fetch(`/api/schedules/${encodeURIComponent(scheduleName)}`, { method: "DELETE" });
    loadSchedules();
  };

  const handleCreate = async () => {
    setError("");
    const freq = FREQUENCIES[freqIndex];
    const cron = freq.label === "Custom cron" ? customCron : freq.cron(time);
    if (!name.trim() || !prompt.trim() || !cron.trim()) {
      setError("Name, prompt, and schedule are required.");
      return;
    }
    setCreating(true);
    try {
      const resp = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), cron, prompt: prompt.trim() }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        setError(data.detail || "Failed to create schedule");
      } else {
        setShowCreate(false);
        setName("");
        setPrompt("");
        setCustomCron("");
        loadSchedules();
      }
    } catch {
      setError("Network error");
    }
    setCreating(false);
  };

  if (!visible) return null;

  const needsTime = freqIndex >= 2 && freqIndex <= 4;
  const isCustom = FREQUENCIES[freqIndex].label === "Custom cron";

  return (
    <SlidePanel visible={visible} onClose={onClose}>
      <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
        <span className="font-semibold text-gray-200">Scheduled Tasks</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-200 rounded-lg px-3 py-1.5 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New task
          </button>
          <CloseButton onClick={onClose} />
        </div>
      </div>

        {/* Description */}
        <div className="px-3 py-2 text-xs text-gray-500 border-b border-[var(--border)]">
          Run tasks on a schedule or whenever you need them. Use <code className="bg-[var(--bg-badge)] px-1 rounded text-gray-400">/schedule</code> in chat to set one up.
        </div>

        {/* Schedule list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {loading && <div className="text-gray-500 text-sm p-4">Loading...</div>}
          {!loading && schedules.length === 0 && (
            <div className="text-gray-500 text-sm p-4 text-center">No scheduled tasks</div>
          )}
          {schedules.map((s) => (
            <div key={s.name} className="border border-[var(--border)] rounded-lg p-3 mb-2 bg-[var(--bg-surface)]">
              <div className="flex justify-between items-start mb-1">
                <span className="text-sm font-medium text-gray-200">{s.name}</span>
                <button
                  onClick={() => removeSchedule(s.name)}
                  className="text-gray-500 hover:text-red-400 p-0.5 rounded transition-colors"
                  title="Remove"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              <div className="text-xs text-gray-400 mb-1.5 line-clamp-2">{s.prompt}</div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="font-mono bg-[var(--bg-badge)] px-1.5 py-0.5 rounded">{s.cron}</span>
                <span>Next: {formatNextRun(s.next_run)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-[var(--border)]">
          <button
            onClick={loadSchedules}
            className="w-full text-xs bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 rounded-lg py-2 transition-colors"
          >
            Refresh
          </button>
        </div>


      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-base font-semibold text-white">New scheduled task</h2>
            </div>

            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="daily-code-review"
                  className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Prompt <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Review yesterday's commits and flag anything concerning..."
                  rows={4}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Frequency</label>
                <select
                  value={freqIndex}
                  onChange={(e) => setFreqIndex(parseInt(e.target.value))}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                >
                  {FREQUENCIES.map((f, i) => (
                    <option key={i} value={i}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* Time picker (for daily/weekday/weekly) */}
              {needsTime && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Time</label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Custom cron input */}
              {isCustom && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Cron expression</label>
                  <input
                    type="text"
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    placeholder="*/15 * * * *"
                    className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Format: minute hour day-of-month month day-of-week
                  </p>
                </div>
              )}

              {error && (
                <div className="text-sm text-red-400 bg-red-600/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !name.trim() || !prompt.trim()}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? "Creating..." : "Create task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SlidePanel>
  );
}
