import React, { useEffect, useState } from "react";

interface SystemPromptPanelProps {
  visible: boolean;
  onClose: () => void;
}

interface PromptData {
  agent: string;
  prompt: string;
  temperature: number;
  tool_count: number;
}

export function SystemPromptPanel({ visible, onClose }: SystemPromptPanelProps) {
  const [data, setData] = useState<PromptData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetch("/api/identity/system-prompt")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [visible]);

  if (!visible) return null;

  // Count sections separated by ---
  const sections = data?.prompt.split("\n\n---\n\n") || [];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-white">System Prompt</span>
            {data && (
              <span className="text-xs text-gray-500">
                agent: {data.agent} | temp: {data.temperature} | tools: {data.tool_count} | {data.prompt.length.toLocaleString()} chars | {sections.length} sections
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {loading && <div className="text-sm text-gray-500">Loading...</div>}
          {!loading && !data && <div className="text-sm text-red-400">Failed to load system prompt.</div>}
          {!loading && data && (
            <div className="space-y-4">
              {sections.map((section, i) => (
                <div key={i} className="relative">
                  <div className="absolute -left-3 top-0 text-[10px] text-gray-600 font-mono select-none">{i + 1}</div>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed bg-[var(--bg-deeper)] rounded-lg p-4 border border-[var(--border)]">
                    {section}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
