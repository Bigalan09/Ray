import { describe, test, expect } from "bun:test";
import { chatReducer, initialChatState, type ChatState, type ChatAction } from "./chat-reducer";

function reduce(state: ChatState, ...actions: ChatAction[]): ChatState {
  return actions.reduce((s, a) => chatReducer(s, a), state);
}

describe("chatReducer", () => {
  // --- SEND_START ---

  test("SEND_START transitions idle to sending", () => {
    const msg = { role: "user" as const, content: "hi" };
    const next = chatReducer(initialChatState, { type: "SEND_START", userMessage: msg });
    expect(next.phase).toBe("sending");
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].content).toBe("hi");
  });

  test("SEND_START is ignored when not idle", () => {
    const sending = { ...initialChatState, phase: "streaming" as const };
    const msg = { role: "user" as const, content: "hi" };
    const next = chatReducer(sending, { type: "SEND_START", userMessage: msg });
    expect(next.phase).toBe("streaming");
    expect(next.messages).toHaveLength(0);
  });

  test("SEND_START sets bootstrapping flag", () => {
    const msg = { role: "user" as const, content: "bootstrap" };
    const next = chatReducer(initialChatState, { type: "SEND_START", userMessage: msg, bootstrapping: true });
    expect(next.bootstrapping).toBe(true);
  });

  test("SEND_START clears previous retry context", () => {
    const state = { ...initialChatState, retryContext: { messages: [], convId: "x" } };
    const msg = { role: "user" as const, content: "hi" };
    const next = chatReducer(state, { type: "SEND_START", userMessage: msg });
    expect(next.retryContext).toBeNull();
  });

  // --- STREAM_CHUNK ---

  test("STREAM_CHUNK transitions sending to streaming", () => {
    const sending = { ...initialChatState, phase: "sending" as const };
    const next = chatReducer(sending, { type: "STREAM_CHUNK", fullText: "Hello" });
    expect(next.phase).toBe("streaming");
    expect(next.currentResponse).toBe("Hello");
  });

  test("STREAM_CHUNK updates currentResponse during streaming", () => {
    const streaming = { ...initialChatState, phase: "streaming" as const, currentResponse: "Hello" };
    const next = chatReducer(streaming, { type: "STREAM_CHUNK", fullText: "Hello world" });
    expect(next.currentResponse).toBe("Hello world");
  });

  test("STREAM_CHUNK is ignored when idle", () => {
    const next = chatReducer(initialChatState, { type: "STREAM_CHUNK", fullText: "nope" });
    expect(next.currentResponse).toBe("");
  });

  // --- STREAM_TOOL ---

  test("STREAM_TOOL adds tool to streamTools", () => {
    const sending = { ...initialChatState, phase: "sending" as const };
    const tool = { name: "calculator", status: "running" as const, arguments: { expression: "2+2" } };
    const next = chatReducer(sending, { type: "STREAM_TOOL", tool });
    expect(next.phase).toBe("streaming");
    expect(next.streamTools).toHaveLength(1);
    expect(next.streamTools[0].name).toBe("calculator");
  });

  test("STREAM_TOOL merges arguments from running to completed", () => {
    const state: ChatState = {
      ...initialChatState,
      phase: "streaming",
      streamTools: [{ name: "calc", status: "running", arguments: { expr: "1+1" } }],
    };
    const completed = { name: "calc", status: "success" as const, result: { value: 2 } };
    const next = chatReducer(state, { type: "STREAM_TOOL", tool: completed });
    expect(next.streamTools).toHaveLength(1);
    expect(next.streamTools[0].status).toBe("success");
    expect(next.streamTools[0].arguments).toEqual({ expr: "1+1" });
  });

  // --- STREAM_END ---

  test("STREAM_END commits assistant message and transitions to committing", () => {
    const state: ChatState = {
      ...initialChatState,
      phase: "streaming",
      messages: [{ role: "user", content: "hi" }],
      currentResponse: "Hello!",
    };
    const next = chatReducer(state, { type: "STREAM_END", finalText: "Hello!" });
    expect(next.phase).toBe("committing");
    expect(next.messages).toHaveLength(2);
    expect(next.messages[1].role).toBe("assistant");
    expect(next.messages[1].content).toBe("Hello!");
    expect(next.currentResponse).toBe("");
    expect(next.bootstrapping).toBe(false);
  });

  test("STREAM_END with empty text does not add a message", () => {
    const state: ChatState = {
      ...initialChatState,
      phase: "streaming",
      messages: [{ role: "user", content: "hi" }],
    };
    const next = chatReducer(state, { type: "STREAM_END", finalText: "" });
    expect(next.phase).toBe("committing");
    expect(next.messages).toHaveLength(1);
  });

  test("STREAM_END with tools but no text adds tool-only message", () => {
    const state: ChatState = { ...initialChatState, phase: "streaming" };
    const tools = [{ name: "calc", status: "success" as const }];
    const next = chatReducer(state, { type: "STREAM_END", finalText: "", tools });
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].content).toBe("");
    expect(next.messages[0].tools).toEqual(tools);
  });

  test("STREAM_END is ignored when idle", () => {
    const next = chatReducer(initialChatState, { type: "STREAM_END", finalText: "nope" });
    expect(next.messages).toHaveLength(0);
  });

  // --- STREAM_ERROR ---

  test("STREAM_ERROR transitions to idle with error message", () => {
    const state: ChatState = { ...initialChatState, phase: "streaming" };
    const next = chatReducer(state, {
      type: "STREAM_ERROR",
      message: "Rate limited",
      retryable: true,
      retryMessages: [{ role: "user", content: "hi" }],
      retryConvId: "conv1",
    });
    expect(next.phase).toBe("idle");
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("system");
    expect(next.messages[0].content).toContain("Rate limited");
    expect(next.retryContext).toEqual({
      messages: [{ role: "user", content: "hi" }],
      convId: "conv1",
    });
  });

  test("STREAM_ERROR with retryable=false does not set retryContext", () => {
    const state: ChatState = { ...initialChatState, phase: "streaming" };
    const next = chatReducer(state, { type: "STREAM_ERROR", message: "Bad", retryable: false });
    expect(next.retryContext).toBeNull();
  });

  // --- COMMAND_RESULT ---

  test("COMMAND_RESULT appends assistant message", () => {
    const next = chatReducer(initialChatState, {
      type: "COMMAND_RESULT",
      content: "Bootstrap done.",
    });
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("assistant");
    expect(next.messages[0].content).toBe("Bootstrap done.");
  });

  test("COMMAND_RESULT with clear action resets messages", () => {
    const state: ChatState = {
      ...initialChatState,
      messages: [{ role: "user", content: "hi" }],
      activeConversationId: "abc",
    };
    const next = chatReducer(state, { type: "COMMAND_RESULT", content: "", action: "clear" });
    expect(next.messages).toHaveLength(0);
    expect(next.activeConversationId).toBeNull();
  });

  // --- STOP ---

  test("STOP transitions streaming to idle with partial text", () => {
    const state: ChatState = { ...initialChatState, phase: "streaming" };
    const next = chatReducer(state, { type: "STOP", partialText: "Partial response" });
    expect(next.phase).toBe("idle");
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].content).toBe("Partial response");
  });

  test("STOP without partial text does not add message", () => {
    const state: ChatState = {
      ...initialChatState,
      phase: "streaming",
      messages: [{ role: "user", content: "hi" }],
    };
    const next = chatReducer(state, { type: "STOP" });
    expect(next.phase).toBe("idle");
    expect(next.messages).toHaveLength(1);
  });

  test("STOP is ignored when idle", () => {
    const next = chatReducer(initialChatState, { type: "STOP", partialText: "nope" });
    expect(next.phase).toBe("idle");
    expect(next.messages).toHaveLength(0);
  });

  // --- COMMIT_DONE ---

  test("COMMIT_DONE transitions committing to idle", () => {
    const state: ChatState = { ...initialChatState, phase: "committing" as const };
    const convos = [{ id: "1", title: "Chat", updated_at: "2026-01-01" }];
    const next = chatReducer(state, { type: "COMMIT_DONE", conversations: convos, taskConversations: [] });
    expect(next.phase).toBe("idle");
    expect(next.conversations).toEqual(convos);
  });

  // --- SELECT_CONVERSATION ---

  test("SELECT_CONVERSATION replaces messages when idle", () => {
    const msgs = [{ role: "user" as const, content: "loaded" }];
    const next = chatReducer(initialChatState, { type: "SELECT_CONVERSATION", id: "conv1", messages: msgs });
    expect(next.activeConversationId).toBe("conv1");
    expect(next.messages).toEqual(msgs);
  });

  test("SELECT_CONVERSATION is blocked during streaming", () => {
    const state: ChatState = { ...initialChatState, phase: "streaming" };
    const next = chatReducer(state, {
      type: "SELECT_CONVERSATION",
      id: "conv1",
      messages: [{ role: "user", content: "loaded" }],
    });
    expect(next.activeConversationId).toBeNull();
    expect(next.messages).toHaveLength(0);
  });

  test("SELECT_CONVERSATION is blocked during committing", () => {
    const state: ChatState = {
      ...initialChatState,
      phase: "committing",
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello!" }],
    };
    const next = chatReducer(state, {
      type: "SELECT_CONVERSATION",
      id: "other",
      messages: [],
    });
    expect(next.messages).toHaveLength(2);
    expect(next.activeConversationId).toBeNull();
  });

  // --- NEW_CHAT ---

  test("NEW_CHAT resets conversation state", () => {
    const state: ChatState = {
      ...initialChatState,
      activeConversationId: "conv1",
      messages: [{ role: "user", content: "hi" }],
    };
    const next = chatReducer(state, { type: "NEW_CHAT" });
    expect(next.activeConversationId).toBeNull();
    expect(next.messages).toHaveLength(0);
  });

  // --- SET_MODELS ---

  test("SET_MODELS sets models and selects first as default", () => {
    const models = [{ id: "gpt-5-mini", model: "GPT-5 mini" }, { id: "gpt-5-nano", model: "GPT-5 nano" }];
    const next = chatReducer(initialChatState, { type: "SET_MODELS", models });
    expect(next.models).toEqual(models);
    expect(next.selectedModel).toBe("gpt-5-mini");
  });

  test("SET_MODELS with empty list sets empty selectedModel", () => {
    const next = chatReducer(initialChatState, { type: "SET_MODELS", models: [] });
    expect(next.selectedModel).toBe("");
  });

  // --- RETRY ---

  test("RETRY transitions idle to sending when retryContext exists", () => {
    const state: ChatState = {
      ...initialChatState,
      retryContext: { messages: [{ role: "user", content: "hi" }], convId: "c1" },
    };
    const next = chatReducer(state, { type: "RETRY" });
    expect(next.phase).toBe("sending");
    expect(next.retryContext).toBeNull();
  });

  test("RETRY is ignored without retryContext", () => {
    const next = chatReducer(initialChatState, { type: "RETRY" });
    expect(next.phase).toBe("idle");
  });

  // --- Full lifecycle ---

  test("full send/stream/commit lifecycle", () => {
    const final = reduce(
      initialChatState,
      { type: "SEND_START", userMessage: { role: "user", content: "hi" } },
      { type: "STREAM_CHUNK", fullText: "Hello" },
      { type: "STREAM_CHUNK", fullText: "Hello!" },
      { type: "STREAM_USAGE", tokens: { total: 10, prompt: 5, completion: 5 } },
      { type: "STREAM_TIMING", durationS: 1.2 },
      { type: "STREAM_END", finalText: "Hello!" },
      { type: "COMMIT_DONE", conversations: [], taskConversations: [] },
    );
    expect(final.phase).toBe("idle");
    expect(final.messages).toHaveLength(2);
    expect(final.messages[0].role).toBe("user");
    expect(final.messages[1].role).toBe("assistant");
    expect(final.messages[1].content).toBe("Hello!");
    expect(final.currentResponse).toBe("");
    expect(final.tokens.total).toBe(10);
    expect(final.duration).toBe(1.2);
  });

  test("conversation selection blocked during full lifecycle", () => {
    let state = initialChatState;

    state = chatReducer(state, { type: "SEND_START", userMessage: { role: "user", content: "hi" } });
    // Try to select during sending
    state = chatReducer(state, { type: "SELECT_CONVERSATION", id: "x", messages: [] });
    expect(state.phase).toBe("sending");
    expect(state.activeConversationId).toBeNull();

    state = chatReducer(state, { type: "STREAM_CHUNK", fullText: "Hello" });
    // Try to select during streaming
    state = chatReducer(state, { type: "SELECT_CONVERSATION", id: "x", messages: [] });
    expect(state.phase).toBe("streaming");

    state = chatReducer(state, { type: "STREAM_END", finalText: "Hello" });
    // Try to select during committing
    state = chatReducer(state, { type: "SELECT_CONVERSATION", id: "x", messages: [] });
    expect(state.phase).toBe("committing");

    state = chatReducer(state, { type: "COMMIT_DONE", conversations: [], taskConversations: [] });
    // Now selection works
    state = chatReducer(state, { type: "SELECT_CONVERSATION", id: "x", messages: [{ role: "user", content: "loaded" }] });
    expect(state.activeConversationId).toBe("x");
    expect(state.messages).toHaveLength(1);
  });
});
