import React from "react";

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  taskConversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onNew: () => void;
  visible: boolean;
  onShowTasks: () => void;
  onShowSchedules: () => void;
  onShowMCP: () => void;
  onShowHooks: () => void;
  onShowMemory: () => void;
  onShowSkills: () => void;
  taskAlertCount?: number;
}

function groupByDate(conversations: Conversation[]): Record<string, Conversation[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);

  const groups: Record<string, Conversation[]> = {};

  for (const conv of conversations) {
    const d = new Date(conv.updated_at);
    let label: string;
    if (d >= today) label = "Today";
    else if (d >= yesterday) label = "Yesterday";
    else if (d >= weekAgo) label = "This week";
    else label = "Older";

    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }
  return groups;
}

interface NavButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  badge?: number;
  variant?: "default" | "danger";
}

function NavButton({ onClick, icon, label, collapsed, badge, variant = "default" }: NavButtonProps) {
  const colors = variant === "danger"
    ? "text-gray-500 hover:text-red-400"
    : "text-gray-400 hover:text-white";

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 py-1.5 text-sm ${colors} hover:bg-[var(--bg-surface)] rounded-lg transition-colors ${
        collapsed ? "justify-center px-1.5" : "px-2"
      }`}
      title={collapsed ? label : undefined}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge && badge > 0 ? (
        <span className="ml-auto bg-blue-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 flex items-center justify-center px-1.5">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function ConversationList({
  conversations,
  taskConversations,
  activeId,
  onSelect,
  onDelete,
  onDeleteAll,
  onNew,
  visible,
  onShowTasks,
  onShowSchedules,
  onShowMCP,
  onShowHooks,
  onShowMemory,
  onShowSkills,
  taskAlertCount = 0,
}: ConversationListProps) {
  const [tasksExpanded, setTasksExpanded] = React.useState(true);
  const grouped = groupByDate(conversations);
  const groupOrder = ["Today", "Yesterday", "This week", "Older"];
  const collapsed = !visible;

  return (
    <div
      className="bg-[var(--bg-deeper)] border-r border-[var(--border)] flex flex-col h-full overflow-hidden transition-all duration-200 ease-in-out"
      style={{ width: collapsed ? 48 : 256, minWidth: collapsed ? 48 : 256 }}
    >
      {/* Navigation buttons */}
      <div className={`pt-3 pb-1 flex flex-col gap-0.5 ${collapsed ? "px-1" : "px-3"}`}>
        <NavButton
          onClick={onNew}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>}
          label="New session"
          collapsed={collapsed}
        />
        <NavButton
          onClick={onShowTasks}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          label="Tasks"
          collapsed={collapsed}
          badge={taskAlertCount}
        />
        <NavButton
          onClick={onShowSchedules}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
          label="Scheduled"
          collapsed={collapsed}
        />
        <NavButton
          onClick={onShowMCP}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
          label="MCP Servers"
          collapsed={collapsed}
        />
        <NavButton
          onClick={onShowHooks}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>}
          label="Webhooks"
          collapsed={collapsed}
        />
        <NavButton
          onClick={onShowMemory}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" /></svg>}
          label="Memory"
          collapsed={collapsed}
        />
        <NavButton
          onClick={onShowSkills}
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>}
          label="Skills"
          collapsed={collapsed}
        />
      </div>

      {/* Session list (hidden when collapsed) */}
      {!collapsed && (
        <>
          <div className="flex-1 overflow-y-auto custom-scrollbar mt-2">
            {/* Task conversations section */}
            {taskConversations.length > 0 && (
              <div>
                <button
                  onClick={() => setTasksExpanded(!tasksExpanded)}
                  className="w-full flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <svg className={`w-3 h-3 transition-transform ${tasksExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Automation
                </button>
                {tasksExpanded && taskConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-2 mx-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      conv.id === activeId
                        ? "bg-[var(--bg-surface)] text-white"
                        : "text-gray-300 hover:bg-[var(--bg-surface)]"
                    }`}
                    onClick={() => onSelect(conv.id)}
                  >
                    <svg className="w-3.5 h-3.5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm truncate flex-1">{conv.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(conv.id);
                      }}
                      className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Regular conversations */}
            {conversations.length === 0 && taskConversations.length === 0 && (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">No sessions yet</div>
            )}
            {groupOrder.map((label) => {
              const items = grouped[label];
              if (!items || items.length === 0) return null;
              return (
                <div key={label}>
                  <div className="px-4 pt-3 pb-1 text-xs font-medium text-gray-500">{label}</div>
                  {items.map((conv) => (
                    <div
                      key={conv.id}
                      className={`group flex items-center gap-2 mx-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        conv.id === activeId
                          ? "bg-[var(--bg-surface)] text-white"
                          : "text-gray-300 hover:bg-[var(--bg-surface)]"
                      }`}
                      onClick={() => onSelect(conv.id)}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        conv.id === activeId ? "bg-blue-400" : "bg-gray-600"
                      }`} />
                      <span className="text-sm truncate flex-1">{conv.title}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(conv.id);
                        }}
                        className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                        title="Delete"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Clear all sessions */}
          {(conversations.length > 0 || taskConversations.length > 0) && (
            <div className="px-3 py-2 border-t border-[var(--border)]">
              <button
                onClick={() => {
                  if (window.confirm("Delete all sessions? This cannot be undone.")) {
                    onDeleteAll();
                  }
                }}
                className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-500 hover:text-red-400 hover:bg-[var(--bg-surface)] rounded-lg transition-colors w-full"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear all sessions
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
