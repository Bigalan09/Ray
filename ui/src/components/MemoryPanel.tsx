import React, { useState, useEffect } from "react";

interface Memory {
  id: string;
  content: string;
  metadata: {
    timestamp?: string;
    tags?: string;
    source?: string;
  };
  distance?: number;
}

interface MemoryPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function MemoryPanel({ visible, onClose }: MemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const reqSeq = React.useRef(0);

  useEffect(() => {
    if (visible) loadMemories();
  }, [visible]);

  const loadMemories = async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const resp = await fetch("/api/memory?limit=50");
      if (!resp.ok) throw new Error(`${resp.status}`);
      const data = await resp.json();
      if (seq === reqSeq.current) setMemories(data.memories || []);
    } catch (err) {
      console.error("Failed to load memories:", err);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      loadMemories();
      return;
    }
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const resp = await fetch("/api/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), limit: 20 }),
      });
      if (!resp.ok) throw new Error(`${resp.status}`);
      const data = await resp.json();
      if (seq === reqSeq.current) setMemories(data.results || []);
    } catch (err) {
      console.error("Failed to search memories:", err);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/memory/${id}`, { method: "DELETE" });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error("Failed to delete memory:", err);
    } finally {
      setDeleting(null);
    }
  };

  const handleClearSearch = () => {
    setQuery("");
    loadMemories();
  };

  if (!visible) return null;

  return (
    <div className="fixed top-10 left-0 right-0 bottom-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div className="w-96 bg-[var(--bg-deeper)] border-l border-[var(--border)] flex flex-col h-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
          <span className="font-semibold text-gray-200">Memory</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white rounded-lg p-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-2 border-b border-[var(--border)]">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories..."
              className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 placeholder-gray-500"
            />
            {query && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="text-gray-400 hover:text-white p-1.5 rounded-lg transition-colors"
                title="Clear search"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
            >
              Search
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {loading && (
            <div className="text-gray-500 text-sm p-4 text-center">Loading...</div>
          )}
          {!loading && memories.length === 0 && (
            <div className="text-gray-500 text-sm p-4 text-center">
              {query ? "No memories match your search." : "No memories stored yet."}
              <br />
              <span className="text-xs">Use memory_store or ask Ray to remember things.</span>
            </div>
          )}
          {!loading && memories.map((mem) => (
            <div key={mem.id} className="border border-[var(--border)] rounded-lg p-3 mb-2 bg-[var(--bg-surface)] group">
              <div className="flex justify-between items-start gap-2">
                <p className="text-sm text-gray-200 flex-1 break-words leading-relaxed">{mem.content}</p>
                <button
                  onClick={() => handleDelete(mem.id)}
                  disabled={deleting === mem.id}
                  className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded shrink-0 mt-0.5 disabled:opacity-30"
                  title="Delete memory"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {mem.metadata.timestamp && (
                  <span className="text-xs text-gray-500">
                    {new Date(mem.metadata.timestamp).toLocaleDateString()}
                  </span>
                )}
                {mem.metadata.tags && (
                  <span className="text-xs text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded">
                    {mem.metadata.tags}
                  </span>
                )}
                {mem.metadata.source && mem.metadata.source !== "user" && (
                  <span className="text-xs text-gray-600">{mem.metadata.source}</span>
                )}
                {mem.distance != null && (
                  <span className="text-xs text-gray-600">
                    {Math.round((1 - mem.distance) * 100)}% match
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
