import { SlidePanel, CloseButton } from "./SlidePanel";
import React, { useState, useEffect, useRef } from "react";

type TabKey = "soul" | "me" | "identity";

interface Tab {
  key: TabKey;
  label: string;
  endpoint: string;
  description: string;
}

const TABS: Tab[] = [
  { key: "soul",     label: "Soul",     endpoint: "/api/identity/soul",     description: "Ray's personality and core principles (SOUL.md)" },
  { key: "me",       label: "User",     endpoint: "/api/identity/me",       description: "Your profile and preferences (USER.md)" },
  { key: "identity", label: "Identity", endpoint: "/api/identity/identity", description: "Ray's self-identity, created during bootstrap (IDENTITY.md)" },
];

interface WorkspacePanelProps {
  visible: boolean;
  onClose: () => void;
}

export function WorkspacePanel({ visible, onClose }: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("soul");
  const [contents, setContents] = useState<Record<TabKey, string>>({
    soul: "",
    me: "",
    identity: "",
  });
  const [loading, setLoading] = useState<Record<TabKey, boolean>>({
    soul: false,
    me: false,
    identity: false,
  });
  const [saving, setSaving] = useState<Record<TabKey, boolean>>({
    soul: false,
    me: false,
    identity: false,
  });
  const [saved, setSaved] = useState<Record<TabKey, boolean>>({
    soul: false,
    me: false,
    identity: false,
  });
  const [errors, setErrors] = useState<Record<TabKey, string | null>>({
    soul: null,
    me: null,
    identity: null,
  });

  const reqSeq = useRef<Record<TabKey, number>>({ soul: 0, me: 0, identity: 0 });
  const savedTimers = useRef<Record<TabKey, ReturnType<typeof setTimeout> | null>>({
    soul: null,
    me: null,
    identity: null,
  });
  // Track which tabs have been loaded to avoid re-fetching on tab switch
  const loadedTabs = useRef<Set<TabKey>>(new Set());

  useEffect(() => {
    if (visible) {
      // Reset loaded state when panel reopens so content is always fresh
      loadedTabs.current = new Set();
      loadTab(activeTab);
    }
  }, [visible]);

  // Load tab content on first visit to that tab
  useEffect(() => {
    if (visible && !loadedTabs.current.has(activeTab)) {
      loadTab(activeTab);
    }
  }, [activeTab]);

  // Clean up pending "Saved" timers on unmount
  useEffect(() => {
    return () => {
      TABS.forEach((t) => {
        if (savedTimers.current[t.key]) clearTimeout(savedTimers.current[t.key]!);
      });
    };
  }, []);

  const loadTab = async (key: TabKey) => {
    const tab = TABS.find((t) => t.key === key)!;
    loadedTabs.current.add(key);
    const seq = ++reqSeq.current[key];
    setLoading((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));
    try {
      const resp = await fetch(tab.endpoint);
      if (!resp.ok) throw new Error(`${resp.status}`);
      const data = await resp.json() as { content: string };
      if (seq === reqSeq.current[key]) {
        setContents((prev) => ({ ...prev, [key]: data.content ?? "" }));
      }
    } catch (err) {
      if (seq === reqSeq.current[key]) {
        setErrors((prev) => ({ ...prev, [key]: "Failed to load file." }));
        console.error(`Failed to load identity/${key}:`, err);
      }
    } finally {
      if (seq === reqSeq.current[key]) {
        setLoading((prev) => ({ ...prev, [key]: false }));
      }
    }
  };

  const saveTab = async (key: TabKey) => {
    const tab = TABS.find((t) => t.key === key)!;
    setSaving((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));
    try {
      const resp = await fetch(tab.endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: contents[key] }),
      });
      if (!resp.ok) throw new Error(`${resp.status}`);
      setSaved((prev) => ({ ...prev, [key]: true }));
      if (savedTimers.current[key]) clearTimeout(savedTimers.current[key]!);
      savedTimers.current[key] = setTimeout(() => {
        setSaved((prev) => ({ ...prev, [key]: false }));
      }, 2000);
    } catch (err) {
      setErrors((prev) => ({ ...prev, [key]: "Failed to save file." }));
      console.error(`Failed to save identity/${key}:`, err);
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <SlidePanel visible={visible} onClose={onClose} width="24rem">
      <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
        <span className="font-semibold text-gray-200">Workspace Files</span>
        <CloseButton onClick={onClose} />
      </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "text-gray-200 border-b-2 border-blue-500 bg-[var(--bg-surface)]"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[var(--bg-surface)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
          {TABS.map((tab) => (
            <div
              key={tab.key}
              className={`flex-1 flex flex-col ${activeTab === tab.key ? "" : "hidden"}`}
            >
              {loading[tab.key] ? (
                <div className="text-gray-500 text-sm p-4 text-center flex-1 flex items-center justify-center">
                  Loading...
                </div>
              ) : (
                <div className="flex-1 flex flex-col p-3 gap-3">
                  <p className="text-xs text-gray-500">{tab.description}</p>

                  <textarea
                    className="flex-1 min-h-[300px] resize-none bg-[var(--bg-surface)] border border-[var(--border)] text-gray-200 text-xs font-mono rounded-lg p-3 focus:outline-none focus:border-blue-500 placeholder-gray-500 leading-relaxed"
                    value={contents[tab.key]}
                    onChange={(e) =>
                      setContents((prev) => ({ ...prev, [tab.key]: e.target.value }))
                    }
                    spellCheck={false}
                  />

                  {errors[tab.key] && (
                    <span className="text-xs text-red-400">{errors[tab.key]}</span>
                  )}

                  <div className="flex items-center gap-2 justify-end">
                    {saved[tab.key] && (
                      <span className="text-xs text-green-400 transition-opacity">Saved</span>
                    )}
                    <button
                      onClick={() => saveTab(tab.key)}
                      disabled={saving[tab.key]}
                      className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-1.5 transition-colors"
                    >
                      {saving[tab.key] ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
    </SlidePanel>
  );
}
