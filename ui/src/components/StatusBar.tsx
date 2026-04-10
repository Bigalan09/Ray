import React, { useState } from "react";
import { SystemPromptPanel } from "./SystemPromptPanel";

interface StatusBarProps {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

export function StatusBar({ totalTokens, promptTokens, completionTokens }: StatusBarProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <>
      <div className="border-t border-[var(--border)] bg-[var(--bg-input)] px-4 py-1.5 text-xs">
        <div className="max-w-4xl mx-auto flex gap-4 items-center text-gray-500">
          {totalTokens > 0 && (
            <>
              <span>
                <span className="text-blue-400 font-semibold">{totalTokens.toLocaleString()}</span> total
              </span>
              <span className="text-gray-700">|</span>
              <span>
                <span className="text-blue-400 font-semibold">{promptTokens.toLocaleString()}</span> prompt
              </span>
              <span className="text-gray-700">|</span>
              <span>
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
