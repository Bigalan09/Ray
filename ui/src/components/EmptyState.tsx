import React from "react";
import { RayIcon } from "./RayIcon";
import { ThinkingAnimation } from "./ThinkingAnimation";

interface EmptyStateProps {
  bootstrapping?: boolean;
}

export function EmptyState({ bootstrapping }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-fadeIn">
      <RayIcon className="w-12 h-12 opacity-80" />
      <h2 className="text-xl font-semibold text-white">How can I help?</h2>
      {bootstrapping ? (
        <>
          <p className="text-sm text-gray-400">Setting up Ray for the first time...</p>
          <ThinkingAnimation />
        </>
      ) : (
        <p className="text-sm text-gray-500">Start a conversation or use a /command</p>
      )}
    </div>
  );
}
