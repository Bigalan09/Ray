import React from "react";

interface SlidePanelProps {
  visible: boolean;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}

/** Shared slide-over panel wrapper. All sidebar panels use this. */
export function SlidePanel({ visible, onClose, width = "28rem", children }: SlidePanelProps) {
  if (!visible) return null;
  return (
    <div
      className="fixed top-10 left-0 right-0 bottom-0 bg-black/50 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-deeper)] border-l border-[var(--border)] flex flex-col h-full shadow-2xl"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** Reusable close button (X) for panel headers. */
export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-gray-400 hover:text-white rounded-lg p-1 transition-colors flex-shrink-0"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

/** Shared input class string for panel form fields. */
export const inputCls =
  "w-full text-xs bg-[var(--bg-deeper)] border border-[var(--border)] rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500";
