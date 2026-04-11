import React, { useState, useEffect } from "react";

interface ApiKeyPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function ApiKeyPanel({ visible, onClose }: ApiKeyPanelProps) {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) loadStatus();
  }, [visible]);

  const loadStatus = async () => {
    try {
      const resp = await fetch("/api/auth/status");
      if (!resp.ok) return;
      const data = await resp.json();
      setAuthEnabled(data.auth_enabled);
    } catch {}
  };

  const handleGenerate = async (force = false) => {
    setLoading(true);
    setError(null);
    setGeneratedKey(null);
    try {
      const resp = await fetch(`/api/auth/key${force ? "?force=true" : ""}`, { method: "POST" });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.detail || data.error || `Error ${resp.status}`);
      } else {
        setGeneratedKey(data.api_key);
        setAuthEnabled(true);
      }
    } catch {
      setError("Failed to generate key.");
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm("Revoke the API key? All clients using it will lose access.")) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/auth/key", { method: "DELETE" });
      if (resp.ok || resp.status === 404) {
        setAuthEnabled(false);
        setGeneratedKey(null);
      } else {
        setError("Failed to revoke key.");
      }
    } catch {
      setError("Failed to revoke key.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed top-10 left-0 right-0 bottom-0 bg-black/50 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-96 bg-[var(--bg-deeper)] border-l border-[var(--border)] flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
          <span className="font-semibold text-gray-200">API Key</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white rounded-lg p-1 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
          {/* Status */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            authEnabled
              ? "bg-green-500/10 border border-green-500/30 text-green-400"
              : "bg-[var(--bg-surface)] border border-[var(--border)] text-gray-400"
          }`}>
            <span className={`w-2 h-2 rounded-full ${authEnabled ? "bg-green-400" : "bg-gray-500"}`} />
            {authEnabled ? "Auth enabled — requests require X-API-Key header" : "Auth disabled — no key set"}
          </div>

          {/* Generated key display */}
          {generatedKey && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-amber-400">Copy this key now — it won't be shown again.</p>
              <div className="flex gap-2 items-center">
                <code className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono text-gray-200 break-all">
                  {generatedKey}
                </code>
                <button
                  onClick={handleCopy}
                  className="flex-shrink-0 px-3 py-2 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && <p className="text-xs text-red-400">{error}</p>}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {!authEnabled ? (
              <button
                onClick={() => handleGenerate(false)}
                disabled={loading}
                className="w-full py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
              >
                {loading ? "Generating..." : "Generate API Key"}
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleGenerate(true)}
                  disabled={loading}
                  className="w-full py-2 text-sm font-medium rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-raised)] border border-[var(--border)] disabled:opacity-50 text-gray-300 transition-colors"
                >
                  {loading ? "Rotating..." : "Rotate Key"}
                </button>
                <button
                  onClick={handleRevoke}
                  disabled={loading}
                  className="w-full py-2 text-sm font-medium rounded-lg bg-red-600/30 hover:bg-red-500/50 border border-red-500/30 disabled:opacity-50 text-red-300 transition-colors"
                >
                  Revoke Key
                </button>
              </>
            )}
          </div>

          <p className="text-xs text-gray-500 leading-relaxed">
            When a key is set, all API requests must include an{" "}
            <code className="text-gray-400">X-API-Key</code> header. Public endpoints{" "}
            (<code className="text-gray-400">/health</code>,{" "}
            <code className="text-gray-400">/api/auth/*</code>) are always accessible.
          </p>
        </div>
      </div>
    </div>
  );
}
