import React, { useState, useEffect } from "react";
import { SlidePanel } from "./SlidePanel";

interface DevModePanelProps {
  visible: boolean;
  onClose: () => void;
  onResetComplete?: () => void;
}

export function DevModePanel({ visible, onClose, onResetComplete }: DevModePanelProps) {
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setConfirmText("");
      setResult(null);
      setError(null);
      setResetting(false);
    }
  }, [visible]);

  const handleReset = async () => {
    setResetting(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch("/api/admin/factory-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.detail || "Reset failed");
      } else {
        setResult(data.details || {});
        onResetComplete?.();
      }
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setResetting(false);
      setConfirmText("");
    }
  };

  if (!visible) return null;

  const confirmed = confirmText === "RESET";

  return (
    <SlidePanel visible={visible} onClose={onClose}>
      <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            Dev Mode
          </h2>
          <span className="text-xs px-2 py-0.5 rounded bg-orange-600/30 text-orange-300 font-mono">DEV</span>
        </div>

        <div className="bg-[#2a2a2a] rounded-lg p-4 border border-[var(--border)]">
          <h3 className="text-sm font-medium text-white mb-2">Factory Reset</h3>
          <p className="text-xs text-gray-400 mb-3">
            This will permanently delete all data and return Ray to a fresh install state:
          </p>
          <ul className="text-xs text-gray-400 space-y-1 mb-4 ml-3">
            <li>- All conversations and messages</li>
            <li>- All background tasks</li>
            <li>- All memories (vector store)</li>
            <li>- All uploaded documents</li>
            <li>- Audit log</li>
            <li>- API key</li>
            <li>- Settings overrides</li>
            <li>- Schedules and skills</li>
            <li>- Webhooks and hook rules</li>
            <li>- Identity files (SOUL.md, USER.md, IDENTITY.md)</li>
            <li>- Memory daily logs</li>
          </ul>
          <p className="text-xs text-gray-400 mb-3">
            Workspace will be re-seeded from templates. Bootstrap onboarding will run on next message.
          </p>

          {!result ? (
            <>
              <div className="mb-3">
                <label className="text-xs text-gray-500 block mb-1">
                  Type <span className="font-mono text-orange-400">RESET</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="RESET"
                  className="w-full px-3 py-2 bg-[#1e1e1e] border border-[var(--border)] rounded text-sm text-white font-mono focus:outline-none focus:border-orange-500"
                  disabled={resetting}
                />
              </div>
              <button
                onClick={handleReset}
                disabled={!confirmed || resetting}
                className={`w-full py-2 rounded text-sm font-medium transition-colors ${
                  confirmed && !resetting
                    ? "bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                    : "bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
              >
                {resetting ? "Resetting..." : "Factory Reset"}
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Reset complete
              </div>
              <div className="bg-[#1e1e1e] rounded p-3 max-h-48 overflow-y-auto">
                {Object.entries(result).map(([key, value]) => (
                  <div key={key} className="flex justify-between text-xs py-0.5">
                    <span className="text-gray-400 font-mono">{key}</span>
                    <span className={`font-mono ${value.startsWith("error") ? "text-red-400" : "text-green-400"}`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Reload the page to start fresh.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="w-full py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Reload Now
              </button>
            </div>
          )}

          {error && (
            <div className="mt-2 text-xs text-red-400 bg-red-900/20 rounded p-2">
              {error}
            </div>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}
