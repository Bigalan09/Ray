import React, { useState, useRef, useEffect, useCallback } from "react";
import type { Message, MessageContent } from "@/types";
import { Header } from "@/components/Header";
import { MessageList } from "@/components/MessageList";
import { InputForm, type ImageAttachment } from "@/components/InputForm";
import { EmptyState } from "@/components/EmptyState";
import { StatusBar } from "@/components/StatusBar";
import { ConversationList } from "@/components/ConversationList";
import { TasksPanel } from "@/components/TasksPanel";
import { SchedulePanel } from "@/components/SchedulePanel";
import { MCPPanel } from "@/components/MCPPanel";
import { HooksPanel } from "@/components/HooksPanel";
import { MemoryPanel } from "@/components/MemoryPanel";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { SkillsPanel } from "@/components/SkillsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ApiKeyPanel } from "@/components/ApiKeyPanel";
import { DevModePanel } from "@/components/DevModePanel";
import { ToastContainer, type ToastMessage } from "@/components/Toast";
import { track } from "@/observability/telemetry";
import { useChat } from "@/hooks/useChat";
import "./index.generated.css";

const App: React.FC = () => {
  const chat = useChat();

  // UI-only state (not business logic)
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    if (typeof window !== "undefined") return window.innerWidth >= 768;
    return true;
  });
  const [showTasks, setShowTasks] = useState(false);
  const [showMCP, setShowMCP] = useState(false);
  const [showSchedules, setShowSchedules] = useState(false);
  const [showHooks, setShowHooks] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showDevMode, setShowDevMode] = useState(false);
  const [devModeAvailable, setDevModeAvailable] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [taskAlertCount, setTaskAlertCount] = useState(0);
  const [userInfo, setUserInfo] = useState<{ name: string | null; company: string | null }>({ name: null, company: null });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if dev mode API is available
  useEffect(() => {
    fetch("/api/admin/dev-mode").then((r) => {
      if (r.ok) setDevModeAvailable(true);
    }).catch(() => {});
  }, []);

  // Toast helpers
  const addToast = useCallback((text: string, type: ToastMessage["type"] = "info") => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, text, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Attachment helpers
  const addAttachment = useCallback((att: ImageAttachment) => {
    setAttachments((prev) => [...prev, att]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Fetch user info from bootstrap identity
  useEffect(() => {
    fetch("/api/identity/user-info")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setUserInfo(d); })
      .catch(() => {});
  }, []);

  // Telemetry on load
  useEffect(() => {
    track("page_load", { load_time_ms: Math.round(performance.now()) });
    window.onerror = (msg, src, _line, _col, err) => {
      track("ui_error", {
        error_type: err?.name ?? "Error",
        message: String(msg),
        source: src ?? "",
      });
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ".") {
        e.preventDefault();
        setSidebarVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  // WebSocket for real-time task updates
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let disposed = false;

    function connect() {
      if (disposed) return;
      ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "task_update" && msg.task) {
            const t = msg.task;
            if (t.status === "completed") {
              addToast(`Task completed: ${t.prompt?.substring(0, 60) || "background task"}`, "success");
              setTaskAlertCount((c) => c + 1);
            } else if (t.status === "failed") {
              addToast(`Task failed: ${t.error || t.prompt?.substring(0, 60) || "background task"}`, "error");
              setTaskAlertCount((c) => c + 1);
            }
            chat.refreshConversations();
          }
        } catch {}
      };
      ws.onclose = () => {
        if (!disposed) reconnectTimer = setTimeout(connect, 5000);
      };
      ws.onerror = () => ws?.close();
    }
    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [addToast, chat.refreshConversations]);

  // Auto-scroll on new messages / streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.currentResponse]);

  // Focus textarea when streaming ends
  useEffect(() => {
    if (chat.phase === "idle") {
      textareaRef.current?.focus();
    }
  }, [chat.phase]);

  // Input handlers
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || chat.phase !== "idle") return;
      e.currentTarget.form?.requestSubmit();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || chat.phase !== "idle") return;

    const content = input;
    chat.sendMessage(content, attachments.length > 0 ? attachments : undefined);
    setInput("");
    setAttachments([]);
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarVisible(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleNewChat = () => {
    chat.newChat();
    setInput("");
  };

  const handleFileUploaded = (result: any) => {
    const msg = result.ingested
      ? `Uploaded ${result.source} (${result.chunks} chunks indexed)`
      : `Upload failed: ${result.error || "unknown error"}`;
    // File upload results are shown as system messages. Since messages
    // are now managed by the hook, we dispatch a command_result.
    // For simplicity, append directly via resend mechanism or show a toast.
    addToast(msg, result.ingested ? "success" : "error");
  };

  const openPanel = (panel: string, setter: (v: boolean) => void) => {
    track("panel_open", { panel });
    setter(true);
    if (window.innerWidth < 768) setSidebarVisible(false);
  };

  // Shared InputForm props
  const inputFormProps = {
    input,
    streaming: chat.streaming,
    textareaRef,
    onInputChange: handleInputChange,
    onKeyDown: handleKeyDown,
    onSubmit: handleSubmit,
    onStop: chat.stopStream,
    onFileUploaded: handleFileUploaded,
    attachments,
    onAddAttachment: addAttachment,
    onRemoveAttachment: removeAttachment,
    execPending: chat.execPending,
    onExecApprove: chat.approveExec,
    onExecDeny: chat.denyExec,
    modelLabel: chat.models.find((m) => m.id === chat.selectedModel)?.model,
  };

  const isEmpty = chat.messages.length === 0 && !chat.currentResponse;

  return (
    <div className="font-sans bg-[#1e1e1e] text-[#d4d4d4] h-[100dvh] flex flex-col">
      <Header
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible(!sidebarVisible)}
      />

      <div className="flex-1 flex overflow-hidden">
        <ConversationList
          conversations={chat.conversations}
          taskConversations={chat.taskConversations}
          activeId={chat.activeConversationId}
          onSelect={(id) => {
            chat.selectConversation(id);
            if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarVisible(false);
          }}
          onDelete={chat.deleteConversation}
          onDeleteAll={chat.deleteAllConversations}
          onNew={() => { handleNewChat(); if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarVisible(false); }}
          visible={sidebarVisible}
          onClose={() => setSidebarVisible(false)}
          taskAlertCount={taskAlertCount}
          onShowTasks={() => { openPanel("tasks", setShowTasks); setTaskAlertCount(0); }}
          onShowSchedules={() => openPanel("schedules", setShowSchedules)}
          onShowMCP={() => openPanel("mcp", setShowMCP)}
          onShowHooks={() => openPanel("hooks", setShowHooks)}
          onShowMemory={() => openPanel("memory", setShowMemory)}
          onShowSkills={() => openPanel("skills", setShowSkills)}
          onShowSettings={() => openPanel("settings", setShowSettings)}
          onShowApiKey={() => openPanel("apikey", setShowApiKey)}
          onShowDevMode={devModeAvailable ? () => openPanel("devmode", setShowDevMode) : undefined}
          userInfo={userInfo}
        />

        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <EmptyState bootstrapping={chat.bootstrapping} />
            <div className="w-full max-w-2xl mt-6">
              <InputForm {...inputFormProps} variant="floating" />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <MessageList
              messages={chat.messages}
              currentResponse={chat.currentResponse}
              streaming={chat.streaming}
              bootstrapping={chat.bootstrapping}
              streamTools={chat.streamTools}
              messagesEndRef={messagesEndRef}
              containerRef={containerRef}
              onRetry={chat.retryLast}
              canRetry={chat.canRetry}
              onResend={chat.resendMessage}
              onRegenerate={chat.regenerate}
            />
            <InputForm {...inputFormProps} />
            <StatusBar
              totalTokens={chat.tokens.total}
              promptTokens={chat.tokens.prompt}
              completionTokens={chat.tokens.completion}
              responseDuration={chat.responseDuration}
            />
          </div>
        )}
      </div>

      <TasksPanel visible={showTasks} onClose={() => setShowTasks(false)} />
      <SchedulePanel visible={showSchedules} onClose={() => setShowSchedules(false)} />
      <MCPPanel visible={showMCP} onClose={() => setShowMCP(false)} />
      <HooksPanel visible={showHooks} onClose={() => setShowHooks(false)} />
      <MemoryPanel visible={showMemory} onClose={() => setShowMemory(false)} />
      <WorkspacePanel visible={showWorkspace} onClose={() => setShowWorkspace(false)} />
      <SkillsPanel visible={showSkills} onClose={() => setShowSkills(false)} />
      <SettingsPanel visible={showSettings} onClose={() => setShowSettings(false)} />
      <ApiKeyPanel visible={showApiKey} onClose={() => setShowApiKey(false)} />
      <DevModePanel visible={showDevMode} onClose={() => setShowDevMode(false)} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default App;
