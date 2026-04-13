import React, { useState } from "react";
import { SystemPromptPanel } from "./SystemPromptPanel";

interface StatusBarProps {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  responseDuration?: number | null;
}

export function StatusBar({ totalTokens, promptTokens, completionTokens, responseDuration }: StatusBarProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const hasStats = responseDuration != null || totalTokens > 0;

  return (
    <>
      <div className="border-t border-[var(--border)] bg-[var(--bg-input)] px-4 py-1 text-xs">
        <div className="max-w-4xl mx-auto flex items-center text-gray-500">
          {hasStats ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 hover:text-gray-300 transition-colors"
            >
              {responseDuration != null && (
                <span className="text-blue-400 font-semibold">{responseDuration.toFixed(1)}s</span>
              )}
              {totalTokens > 0 && (
                <span className="text-gray-600 ml-0.5">{totalTokens.toLocaleString()} tokens</span>
              )}
              <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ) : (
            <span className="text-gray-700 text-[11px]">Ready</span>
          )}
          <button
            onClick={() => setShowPrompt(true)}
            className="ml-auto text-gray-700 hover:text-blue-400 font-mono transition-colors"
            title="View system prompt"
          >
            {"{ }"}
          </button>
        </div>
        {expanded && hasStats && (
          <div className="max-w-4xl mx-auto flex gap-3 mt-0.5 text-gray-600 text-[11px] pb-0.5">
            <span><span className="text-blue-400">{promptTokens.toLocaleString()}</span> prompt</span>
            <span><span className="text-blue-400">{completionTokens.toLocaleString()}</span> completion</span>
          </div>
        )}
      </div>
      <SystemPromptPanel visible={showPrompt} onClose={() => setShowPrompt(false)} />
    </>
  );
}
