import { useReducer, useRef, useEffect, useCallback } from "react";
import type { Message, MessageContent, Model } from "@/types";
import type { ImageAttachment } from "@/components/InputForm";
import { SSELineParser } from "./sse-parser";
import { classifyEvent } from "./sse-events";
import { chatReducer, initialChatState, type Conversation } from "./chat-reducer";

// ---------------------------------------------------------------------------
// Telemetry helper
// ---------------------------------------------------------------------------

function track(event: string, props?: Record<string, any>) {
  fetch("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_name: event, ...props }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchConversations(): Promise<{ chats: Conversation[]; tasks: Conversation[] }> {
  const [chatResp, taskResp] = await Promise.all([
    fetch("/api/conversations?source=chat"),
    fetch("/api/conversations?source=task&limit=20"),
  ]);
  return { chats: await chatResp.json(), tasks: await taskResp.json() };
}

async function fetchModels(): Promise<Model[]> {
  const resp = await fetch("/api/models");
  return resp.json();
}

// ---------------------------------------------------------------------------
// useChat hook
// ---------------------------------------------------------------------------

export function useChat() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const abortRef = useRef<AbortController | null>(null);
  const allTextRef = useRef("");
  // Refs for values that async functions need without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  // -------------------------------------------------------------------------
  // Conversation management
  // -------------------------------------------------------------------------

  const refreshConversations = useCallback(async () => {
    try {
      const { chats, tasks } = await fetchConversations();
      dispatch({ type: "SET_CONVERSATIONS", conversations: chats, taskConversations: tasks });
      return chats;
    } catch (err) {
      console.error("Failed to load conversations:", err);
      return [];
    }
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    const s = stateRef.current;
    if (s.phase !== "idle") return;
    if (id === s.activeConversationId && s.messages.length > 0) return;
    try {
      const resp = await fetch(`/api/conversations/${id}`);
      if (!resp.ok) return;
      const data = await resp.json();
      // Re-check guard after async fetch
      if (stateRef.current.phase !== "idle") return;
      dispatch({
        type: "SELECT_CONVERSATION",
        id,
        messages: (data.messages ?? []).map((m: any) => ({ role: m.role, content: m.content })),
      });
    } catch (err) {
      console.error("Failed to load conversation:", err);
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      const { chats, tasks } = await fetchConversations();
      dispatch({ type: "DELETE_CONVERSATION", id, conversations: chats, taskConversations: tasks });
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  }, []);

  const deleteAllConversations = useCallback(async () => {
    try {
      await fetch("/api/conversations", { method: "DELETE" });
      const { chats, tasks } = await fetchConversations();
      dispatch({ type: "DELETE_ALL", conversations: chats, taskConversations: tasks });
    } catch (err) {
      console.error("Failed to delete all conversations:", err);
    }
  }, []);

  const newChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    dispatch({ type: "NEW_CHAT" });
  }, []);

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  async function runStream(
    msgHistory: Message[],
    convId: string | null,
    saveMessages = true,
  ) {
    const abort = new AbortController();
    abortRef.current = abort;
    allTextRef.current = "";
    const model = stateRef.current.selectedModel;

    // Ensure conversation exists
    if (!convId) {
      try {
        const createResp = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        });
        if (!createResp.ok) throw new Error(await createResp.text());
        const conv = await createResp.json();
        if (!conv?.id) throw new Error("Conversation creation returned no id");
        convId = conv.id;

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
      } catch {
        dispatch({ type: "STREAM_ERROR", message: "Could not create a new conversation.", retryable: false });
        return;
      }
    }

    // Start SSE stream
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: msgHistory,
          model: model || undefined,
          conversation_id: convId,
        }),
        signal: abort.signal,
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        let msg = `API error (${resp.status})`;
        try { const p = JSON.parse(errorText); msg = p.message || p.error || msg; } catch { msg = errorText || msg; }
        throw new Error(msg);
      }

      if (!resp.body) throw new Error("No response body");

      const parser = new SSELineParser();
      const reader = resp.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        for (const data of parser.feed(value)) {
          try {
            const event = classifyEvent(JSON.parse(data));
            if (!event) continue;

            switch (event.kind) {
              case "content":
                if (event.text) {
                  allTextRef.current += event.text;
                  dispatch({ type: "STREAM_CHUNK", fullText: allTextRef.current });
                }
                if (event.usage) dispatch({ type: "STREAM_USAGE", tokens: event.usage });
                break;
              case "tool_status":
                dispatch({ type: "STREAM_TOOL", tool: event.tool });
                break;
              case "citations":
                dispatch({ type: "STREAM_CITATIONS", citations: event.citations });
                break;
              case "exec_confirm":
                dispatch({ type: "EXEC_CONFIRM", pendingId: event.pendingId, command: event.command, description: event.description });
                break;
              case "command_result":
                dispatch({ type: "COMMAND_RESULT", content: event.content, action: event.action });
                break;
              case "error":
                track("chat_error", { message: event.message, retryable: event.retryable });
                dispatch({ type: "STREAM_ERROR", message: event.message, retryable: event.retryable, retryMessages: msgHistory, retryConvId: convId });
                return;
              case "timing":
                dispatch({ type: "STREAM_TIMING", durationS: event.durationS });
                track("stream_complete", { duration_s: event.durationS });
                break;
            }
          } catch { /* skip malformed JSON */ }
        }

        for (const data of parser.flush()) {
          try {
            const event = classifyEvent(JSON.parse(data));
            if (event?.kind === "content" && event.text) allTextRef.current += event.text;
          } catch {}
        }
      }

      const s_end = stateRef.current;
      dispatch({
        type: "STREAM_END",
        finalText: allTextRef.current,
        tools: s_end.streamTools.length > 0 ? s_end.streamTools : undefined,
        citations: s_end.streamCitations.length > 0 ? s_end.streamCitations : undefined,
      });

      try {
        const { chats, tasks } = await fetchConversations();
        dispatch({ type: "COMMIT_DONE", conversations: chats, taskConversations: tasks });
      } catch {
        const s = stateRef.current;
        dispatch({ type: "COMMIT_DONE", conversations: s.conversations, taskConversations: s.taskConversations });
      }

      // Recovery: if the stream produced no content but the backend may have
      // saved a response, reload the conversation from the server.
      if (!allTextRef.current && convId) {
        try {
          const recoverResp = await fetch(`/api/conversations/${convId}`);
          if (recoverResp.ok) {
            const data = await recoverResp.json();
            const serverMsgs: Message[] = (data.messages ?? []).map((m: any) => ({
              role: m.role,
              content: m.content,
            }));
            const s = stateRef.current;
            // Only recover if the server has more messages (i.e. an assistant reply we missed)
            if (serverMsgs.length > s.messages.length) {
              dispatch({ type: "SELECT_CONVERSATION", id: convId, messages: serverMsgs });
              track("stream_recovery", { conversation_id: convId, recovered_messages: serverMsgs.length - s.messages.length });
            }
          }
        } catch { /* recovery is best-effort */ }
      }

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Unknown error";
      track("chat_error", { message, retryable: true });
      dispatch({ type: "STREAM_ERROR", message, retryable: true, retryMessages: msgHistory, retryConvId: convId });
    } finally {
      abortRef.current = null;
    }
  }

  // -------------------------------------------------------------------------
  // Public actions
  // -------------------------------------------------------------------------

  const sendMessage = useCallback((
    content: string | MessageContent[],
    attachments?: ImageAttachment[],
  ) => {
    let msgContent: string | MessageContent[];
    if (attachments && attachments.length > 0) {
      const parts: MessageContent[] = [];
      if (typeof content === "string" && content.trim()) {
        parts.push({ type: "text", text: content });
      }
      for (const att of attachments) {
        parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
      }
      msgContent = parts;
    } else {
      msgContent = content;
    }

    const userMessage: Message = { role: "user", content: msgContent };
    const s = stateRef.current;
    dispatch({ type: "SEND_START", userMessage });

    const msgHistory = [...s.messages, userMessage];
    track("message_sent", { has_attachments: (attachments?.length ?? 0) > 0, model: s.selectedModel });

    const convId = s.activeConversationId;
    if (convId) {
      fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: msgContent }),
      }).catch(() => {});
    }

    runStream(msgHistory, convId);
  }, []);

  const stopStream = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    dispatch({ type: "STOP", partialText: allTextRef.current || undefined });
  }, []);

  const retryLast = useCallback(() => {
    const s = stateRef.current;
    if (!s.retryContext || s.phase !== "idle") return;
    const { messages: retryMsgs, convId } = s.retryContext;
    dispatch({ type: "RETRY" });
    runStream(retryMsgs, convId);
  }, []);

  const approveExec = useCallback(async () => {
    const s = stateRef.current;
    if (!s.execPending) return;
    const pendingId = s.execPending.pending_id;
    dispatch({ type: "EXEC_RESOLVE" });
    try {
      const resp = await fetch("/api/exec/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_id: pendingId }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.content) {
          dispatch({ type: "COMMAND_RESULT", content: data.content });
        }
      }
    } catch {}
  }, []);

  const denyExec = useCallback(async () => {
    const s = stateRef.current;
    if (!s.execPending) return;
    dispatch({ type: "EXEC_RESOLVE" });
    await fetch("/api/exec/deny", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pending_id: s.execPending.pending_id }),
    });
  }, []);

  const resendMessage = useCallback((content: string | MessageContent[]) => {
    const text = typeof content === "string" ? content : "";
    const s = stateRef.current;
    if (!text || s.phase !== "idle") return;
    const userMsg: Message = { role: "user", content: text };
    dispatch({ type: "SEND_START", userMessage: userMsg });
    runStream([...s.messages, userMsg], s.activeConversationId);
  }, []);

  const regenerate = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== "idle" || s.messages.length === 0) return;
    // Find messages up to and including the last user message
    const msgs = [...s.messages];
    while (msgs.length > 0 && msgs[msgs.length - 1].role !== "user") {
      msgs.pop();
    }
    if (msgs.length === 0) return;
    dispatch({ type: "REGENERATE" });
    runStream(msgs, s.activeConversationId);
  }, []);

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  useEffect(() => {
    const init = async () => {
      const [models, convResult, bootstrapStatus] = await Promise.all([
        fetchModels().catch(() => [] as Model[]),
        fetchConversations().catch(() => ({ chats: [] as Conversation[], tasks: [] as Conversation[] })),
        fetch("/api/identity/bootstrap-status")
          .then((r) => r.json())
          .catch(() => ({ bootstrapped: true, has_existing_identity: true })),
      ]);

      dispatch({ type: "SET_MODELS", models });
      dispatch({ type: "SET_CONVERSATIONS", conversations: convResult.chats, taskConversations: convResult.tasks });

      if (!bootstrapStatus.bootstrapped && !bootstrapStatus.has_existing_identity) {
        const trigger: Message = { role: "user", content: "[starting up for the first time]" };
        dispatch({ type: "SEND_START", userMessage: trigger, bootstrapping: true });
        runStream([trigger], null, false);
        return;
      }

      if (convResult.chats.length > 0) {
        try {
          const resp = await fetch(`/api/conversations/${convResult.chats[0].id}`);
          if (resp.ok) {
            const data = await resp.json();
            dispatch({
              type: "SELECT_CONVERSATION",
              id: convResult.chats[0].id,
              messages: (data.messages ?? []).map((m: any) => ({ role: m.role, content: m.content })),
            });
          }
        } catch {}
      }
    };

    init();
  }, []);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    messages: state.messages,
    currentResponse: state.currentResponse,
    streamTools: state.streamTools,
    phase: state.phase,
    streaming: state.phase === "sending" || state.phase === "streaming",
    bootstrapping: state.bootstrapping,
    tokens: state.tokens,
    responseDuration: state.duration,
    canRetry: state.retryContext !== null && state.phase === "idle",
    conversations: state.conversations,
    taskConversations: state.taskConversations,
    activeConversationId: state.activeConversationId,
    selectConversation,
    deleteConversation,
    deleteAllConversations,
    newChat,
    refreshConversations,
    models: state.models,
    selectedModel: state.selectedModel,
    execPending: state.execPending,
    approveExec,
    denyExec,
    sendMessage,
    stopStream,
    retryLast,
    resendMessage,
    regenerate,
  };
}
