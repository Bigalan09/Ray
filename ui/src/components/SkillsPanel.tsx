import React, { useState, useEffect, useRef } from "react";

interface Skill {
  name: string;
  description: string;
  prompt: string;
  agent: string;
  builtin?: boolean;
}

interface SkillsPanelProps {
  visible: boolean;
  onClose: () => void;
}

const EMPTY_FORM = { name: "", description: "", prompt: "", agent: "general" };

export function SkillsPanel({ visible, onClose }: SkillsPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    if (visible) loadSkills();
  }, [visible]);

  const loadSkills = async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const resp = await fetch("/api/skills");
      if (!resp.ok) throw new Error(`${resp.status}`);
      const data = await resp.json();
      if (seq === reqSeq.current) setSkills(data.skills || []);
    } catch (err) {
      console.error("Failed to load skills:", err);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.prompt.trim()) {
      setError("Name and prompt are required.");
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || `${resp.status}`);
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      loadSkills();
    } catch (err: any) {
      setError(err.message || "Failed to save skill.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`Delete skill "${name}"?`)) return;
    setDeleting(name);
    try {
      const resp = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError(data.detail || "Failed to delete skill.");
        return;
      }
      loadSkills();
    } catch {
      setError("Failed to delete skill.");
    } finally {
      setDeleting(null);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed top-10 left-0 right-0 bottom-0 bg-black/50 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-[28rem] bg-[var(--bg-deeper)] border-l border-[var(--border)] flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
          <span className="font-semibold text-gray-200">Skills</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowForm(!showForm); setError(null); setForm(EMPTY_FORM); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              {showForm ? "Cancel" : "+ New skill"}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white rounded-lg p-1 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* New skill form */}
          {showForm && (
            <form onSubmit={handleCreate} className="p-3 border-b border-[var(--border)] flex flex-col gap-2 bg-[var(--bg-surface)]">
              <input
                className="bg-[var(--bg-deeper)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="Skill name (e.g. translate)"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className="bg-[var(--bg-deeper)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="Short description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
              <textarea
                className="bg-[var(--bg-deeper)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none min-h-[80px] font-mono"
                placeholder={"Prompt template. Use {input} for user text.\ne.g. Translate to French: {input}"}
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              />
              <input
                className="bg-[var(--bg-deeper)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="Agent (default: general)"
                value={form.agent}
                onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
              >
                {saving ? "Saving..." : "Save skill"}
              </button>
            </form>
          )}

          {/* Skills list */}
          {loading ? (
            <div className="text-gray-500 text-sm p-4 text-center">Loading...</div>
          ) : skills.length === 0 ? (
            <div className="text-gray-500 text-sm p-4 text-center">No skills configured.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {skills.map((skill) => (
                <div key={skill.name} className="px-4 py-3 flex items-start gap-3 group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200">{skill.name}</span>
                      {skill.builtin && (
                        <span className="text-xs text-gray-500 bg-[var(--bg-surface)] px-1.5 py-0.5 rounded">built-in</span>
                      )}
                    </div>
                    {skill.description && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{skill.description}</p>
                    )}
                    <p className="text-xs text-gray-600 mt-1 truncate font-mono">
                      /skill {skill.name} …
                    </p>
                  </div>
                  {!skill.builtin && (
                    <button
                      onClick={() => handleDelete(skill.name)}
                      disabled={deleting === skill.name}
                      className="flex-shrink-0 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded disabled:opacity-50"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
