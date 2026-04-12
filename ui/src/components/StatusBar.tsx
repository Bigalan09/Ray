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

  return (
    <>
      <div className="border-t border-[var(--border)] bg-[var(--bg-input)] px-4 py-1.5 text-xs">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-2 items-center text-gray-500">
          {responseDuration != null && (
            <>
              <span title="Time to respond (including tool calls)">
                <span className="text-blue-400 font-semibold">{responseDuration.toFixed(1)}s</span>
              </span>
              {totalTokens > 0 && <span className="text-gray-700 hidden sm:inline">|</span>}
            </>
          )}
          {totalTokens > 0 && (
            <>
              <span>
                <span className="text-blue-400 font-semibold">{totalTokens.toLocaleString()}</span> total
              </span>
              <span className="text-gray-700 hidden sm:inline">|</span>
              <span className="hidden sm:inline">
                <span className="text-blue-400 font-semibold">{promptTokens.toLocaleString()}</span> prompt
              </span>
              <span className="text-gray-700 hidden sm:inline">|</span>
              <span className="hidden sm:inline">
                <span className="text-blue-400 font-semibold">{completionTokens.toLocaleString()}</span> completion
              </span>
            </>
          )}
          <button
            onClick={() => setShowPrompt(true)}
            className="ml-auto text-gray-600 hover:text-blue-400 font-mono transition-colors"
            title="View system prompt"
          >
            {"{ }"}
          </button>
        </div>
      </div>
      <SystemPromptPanel visible={showPrompt} onClose={() => setShowPrompt(false)} />
    </>
  );
}
