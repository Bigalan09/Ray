import { SlidePanel, CloseButton } from "./SlidePanel";
import React, { useState, useEffect } from "react";

interface Task {
  id: string;
  type: string;
  agent: string;
  prompt: string;
  status: string;
  result?: string;
  error?: string;
  created_at: string;
  completed_at?: string;
}

interface TasksPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function TasksPanel({ visible, onClose }: TasksPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) loadTasks();
  }, [visible]);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/tasks?limit=20");
      setTasks(await resp.json());
    } catch (err) {
      console.error("Failed to load tasks:", err);
    }
    setLoading(false);
  };

  const cancelTask = async (id: string) => {
    await fetch(`/api/tasks/${id}/cancel`, { method: "POST" });
    loadTasks();
  };

  if (!visible) return null;

  const statusColor = (s: string) => {
    if (s === "completed") return "text-green-400";
    if (s === "running") return "text-blue-400";
    if (s === "failed") return "text-red-400";
    if (s === "cancelled") return "text-gray-500";
    return "text-yellow-400";
  };

  return (
    <SlidePanel visible={visible} onClose={onClose} width="24rem">
      <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
        <span className="font-semibold text-gray-200">Background Tasks</span>
        <CloseButton onClick={onClose} />
      </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {loading && <div className="text-gray-500 text-sm p-4">Loading...</div>}
          {!loading && tasks.length === 0 && (
            <div className="text-gray-500 text-sm p-4 text-center">No tasks</div>
          )}
          {tasks.map((task) => (
            <div key={task.id} className="border border-[var(--border)] rounded-lg p-3 mb-2 bg-[var(--bg-surface)]">
              <div className="flex justify-between items-start mb-1">
                <span className="text-xs text-gray-400">{task.agent} / {task.type}</span>
                <span className={`text-xs font-semibold ${statusColor(task.status)}`}>
                  {task.status}
                </span>
              </div>
              <div className="text-sm text-gray-200 mb-2 line-clamp-2">{task.prompt}</div>
              {task.result && (
                <div className="text-xs text-gray-400 bg-[var(--bg-input)] rounded-lg p-2 max-h-24 overflow-y-auto">
                  {task.result.substring(0, 500)}
                </div>
              )}
              {task.error && (
                <div className="text-xs text-red-400 bg-[var(--bg-input)] rounded-lg p-2">{task.error}</div>
              )}
              {(task.status === "pending" || task.status === "running") && (
                <button
                  onClick={() => cancelTask(task.id)}
                  className="text-xs text-red-400 hover:text-red-300 mt-2 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="p-2 border-t border-[var(--border)]">
          <button
            onClick={loadTasks}
            className="w-full text-xs bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 rounded-lg py-2 transition-colors"
          >
            Refresh
          </button>
        </div>
    </SlidePanel>
  );
}
