import React, { useState, useEffect, useRef } from "react";

interface Command {
  name: string;
  description: string;
  usage: string;
}

interface CommandAutocompleteProps {
  filter: string;
  onSelect: (command: string) => void;
  onClose: () => void;
  visible: boolean;
}

export function CommandAutocomplete({ filter, onSelect, onClose, visible }: CommandAutocompleteProps) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/commands")
      .then((r) => r.json())
      .then(setCommands)
      .catch(() => {});
  }, []);

  const filtered = commands.filter((c) =>
    c.name.toLowerCase().startsWith(filter.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    if (!visible) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Tab" || (e.key === "Enter" && filtered.length > 0)) {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].name + " ");
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [visible, filtered, selectedIndex, onSelect, onClose]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--bg-deeper)] border border-[var(--border)] rounded-lg shadow-xl max-h-64 overflow-y-auto z-50"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          onClick={() => onSelect(cmd.name + " ")}
          className={`w-full text-left px-3 py-2 flex items-start gap-3 transition-colors ${
            i === selectedIndex
              ? "bg-blue-600/20 text-white"
              : "text-gray-300 hover:bg-[var(--bg-surface)]"
          }`}
        >
          <span className="font-mono text-sm text-blue-400 shrink-0">{cmd.name}</span>
          <span className="text-xs text-gray-500 truncate">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}
