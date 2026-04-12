import React, { useState, useRef, useEffect, useCallback } from "react";
import type { Message, MessageContent, ToolEvent, Citation } from "@/types";
import { Header } from "@/components/Header";
import { MessageList } from "@/components/MessageList";
import { InputForm, type ImageAttachment } from "@/components/InputForm";
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
import { ToastContainer, type ToastMessage } from "@/components/Toast";
import { track } from "@/observability/telemetry";
import "./index.css";

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

interface Model {
  id: string;
  model: string;
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [totalTokens, setTotalTokens] = useState(0);
  const [promptTokens, setPromptTokens] = useState(0);
  const [completionTokens, setCompletionTokens] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [taskConversations, setTaskConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    // Default to hidden on mobile (< 768px) to avoid obscuring chat content
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
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [taskAlertCount, setTaskAlertCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const retryContextRef = useRef<{ messages: Message[]; convId: string | null } | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [streamTools, setStreamTools] = useState<ToolEvent[]>([]);
  const streamToolsRef = useRef<ToolEvent[]>([]);
  const streamCitationsRef = useRef<Citation[]>([]);
  const [responseDuration, setResponseDuration] = useState<number | null>(null);
  const [execPending, setExecPending] = useState<{
    pending_id: string;
    command: string;
    description: string;
  } | null>(null);

  const addToast = useCallback((text: string, type: ToastMessage["type"] = "info") => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, text, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addAttachment = useCallback((att: ImageAttachment) => {
    setAttachments((prev) => [...prev, att]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleRetry = () => {
    const ctx = retryContextRef.current;
    if (!ctx) return;
    retryContextRef.current = null;
    setStreaming(true);
    setCurrentResponse("");
    streamResponse(ctx.messages, ctx.convId);
  };

  useEffect(() => {
    track("page_load", { load_time_ms: Math.round(performance.now()) });
    window.onerror = (msg, src, _line, _col, err) => {
      track("ui_error", {
        error_type: err?.name ?? "Error",
        message: String(msg),
        source: src ?? "",
      });
    };

    loadModels();

    const init = async () => {
      const [chats, bootstrapStatus] = await Promise.all([
        loadConversations(),
        fetch("/api/identity/bootstrap-status")
          .then((r) => r.json())
          .catch(() => ({ bootstrapped: true, has_existing_identity: true })),
      ]);

      // Only trigger bootstrap on a truly fresh install (no identity files).
      if (!bootstrapStatus.bootstrapped && !bootstrapStatus.has_existing_identity) {
        const trigger: Message = { role: "user", content: "[starting up for the first time]" };
        setStreaming(true);
        // saveMessages=false: the trigger is an internal system prompt, not a real
        // user message — don't persist it to the DB or it will appear in history.
        streamResponse([trigger], null, false);
        return;
      }

      if (chats.length > 0) {
        selectConversation(chats[0].id);
      }
    };

    init();
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
            // Refresh conversations to show new/updated task conversations
            loadConversations();
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
  }, [addToast]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentResponse]);

  const loadModels = async () => {
    try {
      const resp = await fetch("/api/models");
      const data: Model[] = await resp.json();
      setModels(data);
      if (data.length > 0) setSelectedModel(data[0].id);
    } catch (err) {
      console.error("Failed to load models:", err);
    }
  };

  const loadConversations = async (): Promise<Conversation[]> => {
    try {
      const [chatResp, taskResp] = await Promise.all([
        fetch("/api/conversations?source=chat"),
        fetch("/api/conversations?source=task&limit=20"),
      ]);
      const chats = await chatResp.json();
      setConversations(chats);
      setTaskConversations(await taskResp.json());
      return chats;
    } catch (err) {
      console.error("Failed to load conversations:", err);
      return [];
    }
  };

  const selectConversation = async (id: string) => {
    try {
      const resp = await fetch(`/api/conversations/${id}`);
      if (!resp.ok) {
        console.error("Failed to load conversation:", resp.status);
        return;
      }
      const data = await resp.json();
      // Guard: don't overwrite messages if a stream is actively in progress.
      // Check the abort controller's signal rather than the ref itself, since
      // the ref persists after streaming ends.
      if (abortRef.current && !abortRef.current.signal.aborted) return;
      setActiveConversationId(id);
      setMessages(
        (data.messages ?? []).map((m: any) => ({ role: m.role, content: m.content }))
      );
      setCurrentResponse("");
    } catch (err) {
      console.error("Failed to load conversation:", err);
    }
  };

  const deleteAllConversations = async () => {
    try {
      await fetch("/api/conversations", { method: "DELETE" });
      setActiveConversationId(null);
      setMessages([]);
      loadConversations();
    } catch (err) {
      console.error("Failed to delete all conversations:", err);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
      loadConversations();
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const handleNewChat = () => {
    if (streaming && abortRef.current) abortRef.current.abort();
    setActiveConversationId(null);
    setMessages([]);
    setCurrentResponse("");
    setInput("");
    setStreaming(false);
  };

  const handleStop = () => {
    if (abortRef.current) abortRef.current.abort();
    setStreaming(false);
    if (currentResponse) {
      setMessages((msgs) => [...msgs, { role: "assistant", content: currentResponse }]);
      setCurrentResponse("");
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || streaming) return;

    // Build message content: multi-part if images attached, plain string otherwise
    let content: string | MessageContent[];
    if (attachments.length > 0) {
      const parts: MessageContent[] = [];
      if (input.trim()) {
        parts.push({ type: "text", text: input });
      }
      for (const att of attachments) {
        parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
      }
      content = parts;
    } else {
      content = input;
    }

    const userMessage: Message = { role: "user", content };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setAttachments([]);
    setStreaming(true);
    setCurrentResponse("");
    track("message_sent", { has_attachments: attachments.length > 0, model: selectedModel });

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    let convId = activeConversationId;

    if (convId) {
      try {
        await fetch(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content }),
        });
      } catch {}
    }

    await streamResponse(updatedMessages, convId);
  };

  const handleExecApprove = async () => {
    if (!execPending) return;
    setExecPending(null);
    // The backend agent loop is waiting on the asyncio Event.
    // The approve endpoint signals it and the SSE stream continues.
    await fetch("/api/exec/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pending_id: execPending.pending_id }),
    });
  };

  const handleExecDeny = async () => {
    if (!execPending) return;
    setExecPending(null);
    await fetch("/api/exec/deny", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pending_id: execPending.pending_id }),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || streaming) return;
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

  const streamResponse = async (msgHistory: Message[], convId: string | null, saveMessages = true) => {
    abortRef.current = new AbortController();
    setResponseDuration(null);

    // Create conversation if none exists, then persist user messages
    if (!convId) {
      try {
        const createResp = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel }),
        });
        if (!createResp.ok) {
          const errorText = await createResp.text();
          throw new Error(errorText || `Failed to create conversation (${createResp.status})`);
        }
        const conv = await createResp.json();
        if (!conv?.id) {
          throw new Error("Conversation creation returned no id");
        }
        convId = conv.id;
        setActiveConversationId(convId);

        // Save user messages that triggered this conversation.
        // Skip for internal system triggers (e.g. bootstrap) that should not
        // appear in the conversation history.
        if (saveMessages) {
          for (const msg of msgHistory) {
            if (msg.role === "user") {
              try {
                await fetch(`/api/conversations/${convId}/messages`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ role: "user", content: msg.content }),
                });
              } catch {}
            }
          }
        }
      } catch (err) {
        console.error("Failed to create conversation:", err);
        setStreaming(false);
        setCurrentResponse("");
        setMessages((msgs) => [...msgs, { role: "system", content: "Could not create a new conversation." }]);
        return;
      }
    }

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: msgHistory,
          model: selectedModel || undefined,
          conversation_id: convId,
        }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        let msg = `API error (${resp.status})`;
        try {
          const parsed = JSON.parse(errorText);
          msg = parsed.message || parsed.error || msg;
        } catch {
          msg = errorText || msg;
        }
        throw new Error(msg);
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let allText = "";
      streamToolsRef.current = [];
      streamCitationsRef.current = [];
      setStreamTools([]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.ray_metadata) {
              if (parsed.ray_metadata.type === "timing") {
                setResponseDuration(parsed.ray_metadata.duration_s);
                track("stream_complete", { duration_s: parsed.ray_metadata.duration_s });
              }
              continue;
            }

            // Tool call events: merge arguments from "running" into the completion event
            if (parsed.ray_tool) {
              const tool = parsed.ray_tool as ToolEvent;
              const prev = streamToolsRef.current.find(
                (t) => t.name === tool.name && t.status === "running",
              );
              if (prev && tool.status !== "running") {
                tool.arguments = tool.arguments || prev.arguments;
              }
              streamToolsRef.current = [
                ...streamToolsRef.current.filter(
                  (t) => !(t.name === tool.name && t.status === "running"),
                ),
                tool,
              ];
              setStreamTools([...streamToolsRef.current]);
              continue;
            }

            // Citation events from web_search_preview
            if (parsed.ray_citations) {
              streamCitationsRef.current = parsed.ray_citations as Citation[];
              continue;
            }

            // Exec confirmation: show approval bar in input area
            if (parsed.type === "exec_confirm") {
              setExecPending({
                pending_id: parsed.pending_id,
                command: parsed.full_command,
                description: parsed.description || "",
              });
              continue;
            }

            // Slash command result
            if (parsed.type === "command_result") {
              if (parsed.action === "clear") {
                setMessages([]);
                setActiveConversationId(null);
                continue;
              }
              setMessages((msgs) => [
                ...msgs,
                { role: "assistant", content: parsed.content || "" },
              ]);
              continue;
            }

            // Structured error from backend retry logic
            if (parsed.type === "error") {
              const errMsg = parsed.message || "Unknown error";
              track("chat_error", { message: errMsg, retryable: !!parsed.retryable });
              setMessages((msgs) => [
                ...msgs,
                { role: "system", content: `Error: ${errMsg}` },
              ]);
              if (parsed.retryable) {
                retryContextRef.current = { messages: msgHistory, convId };
              }
              continue;
            }

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              allText += content;
              setCurrentResponse(allText);
            }
            if (parsed.usage) {
              setTotalTokens(parsed.usage.total_tokens || 0);
              setPromptTokens(parsed.usage.prompt_tokens || 0);
              setCompletionTokens(parsed.usage.completion_tokens || 0);
            }
          } catch {
            // skip invalid JSON
          }
        }
      }

      const tools = streamToolsRef.current.length > 0 ? [...streamToolsRef.current] : undefined;
      const citations = streamCitationsRef.current.length > 0 ? [...streamCitationsRef.current] : undefined;

      if (allText) {
        setMessages((msgs) => [...msgs, { role: "assistant", content: allText, tools, citations }]);
      } else if (tools) {
        setMessages((msgs) => [...msgs, { role: "assistant", content: "", tools }]);
      }
      setCurrentResponse("");
      setStreamTools([]);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        track("chat_error", { message: err.message, retryable: true });
        setMessages((msgs) => [
          ...msgs,
          { role: "system", content: `Error: ${err.message}` },
        ]);
        retryContextRef.current = { messages: msgHistory, convId };
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      loadConversations();
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  return (
    <div className="font-sans bg-[#1e1e1e] text-[#d4d4d4] h-[100dvh] flex flex-col">
      <Header
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible(!sidebarVisible)}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />

      <div className="flex-1 flex overflow-hidden">
        <ConversationList
          conversations={conversations}
          taskConversations={taskConversations}
          activeId={activeConversationId}
          onSelect={(id) => {
            selectConversation(id);
            // Auto-close drawer on mobile after selecting a conversation
            if (typeof window !== "undefined" && window.innerWidth < 768) {
              setSidebarVisible(false);
            }
          }}
          onDelete={deleteConversation}
          onDeleteAll={deleteAllConversations}
          onNew={() => { handleNewChat(); if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarVisible(false); }}
          visible={sidebarVisible}
          onClose={() => setSidebarVisible(false)}
          taskAlertCount={taskAlertCount}
          onShowTasks={() => { track("panel_open", { panel: "tasks" }); setShowTasks(true); setTaskAlertCount(0); }}
          onShowSchedules={() => { track("panel_open", { panel: "schedules" }); setShowSchedules(true); }}
          onShowMCP={() => { track("panel_open", { panel: "mcp" }); setShowMCP(true); }}
          onShowHooks={() => { track("panel_open", { panel: "hooks" }); setShowHooks(true); }}
          onShowMemory={() => { track("panel_open", { panel: "memory" }); setShowMemory(true); }}
          onShowSkills={() => { track("panel_open", { panel: "skills" }); setShowSkills(true); }}
          onShowSettings={() => { track("panel_open", { panel: "settings" }); setShowSettings(true); }}
        />

        <div className="flex-1 flex flex-col">
          <MessageList
            messages={messages}
            currentResponse={currentResponse}
            streaming={streaming}
            streamTools={streamTools}
            messagesEndRef={messagesEndRef}
            containerRef={containerRef}
            onRetry={handleRetry}
            canRetry={retryContextRef.current !== null}
            onResend={(content) => {
              const text = typeof content === "string" ? content : "";
              if (!text || streaming) return;
              const userMsg: Message = { role: "user", content: text };
              const updated = [...messages, userMsg];
              setMessages(updated);
              setStreaming(true);
              setCurrentResponse("");
              streamResponse(updated, activeConversationId);
            }}
          />

          <InputForm
            input={input}
            streaming={streaming}
            textareaRef={textareaRef}
            onInputChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onSubmit={handleSubmit}
            onStop={handleStop}
            onFileUploaded={(result) => {
              const msg = result.ingested
                ? `Uploaded ${result.source} (${result.chunks} chunks indexed)`
                : `Upload failed: ${result.error || "unknown error"}`;
              setMessages((msgs) => [...msgs, { role: "system", content: msg }]);
            }}
            attachments={attachments}
            onAddAttachment={addAttachment}
            onRemoveAttachment={removeAttachment}
            execPending={execPending}
            onExecApprove={handleExecApprove}
            onExecDeny={handleExecDeny}
          />

          <StatusBar
            totalTokens={totalTokens}
            promptTokens={promptTokens}
            completionTokens={completionTokens}
            responseDuration={responseDuration}
          />
        </div>
      </div>

      <TasksPanel visible={showTasks} onClose={() => setShowTasks(false)} />
      <SchedulePanel visible={showSchedules} onClose={() => setShowSchedules(false)} />
      <MCPPanel visible={showMCP} onClose={() => setShowMCP(false)} />
      <HooksPanel visible={showHooks} onClose={() => setShowHooks(false)} />
      <MemoryPanel visible={showMemory} onClose={() => setShowMemory(false)} />
      <WorkspacePanel visible={showWorkspace} onClose={() => setShowWorkspace(false)} />
      <SkillsPanel visible={showSkills} onClose={() => setShowSkills(false)} />
      <SettingsPanel visible={showSettings} onClose={() => setShowSettings(false)} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default App;
