import { describe, test, expect } from "bun:test";
import { classifyEvent, type SSEEvent } from "./sse-events";

describe("classifyEvent", () => {
  test("returns null for null/undefined input", () => {
    expect(classifyEvent(null)).toBeNull();
    expect(classifyEvent(undefined)).toBeNull();
  });

  test("returns null for empty object", () => {
    expect(classifyEvent({})).toBeNull();
  });

  // --- Timing metadata ---

  test("classifies timing metadata", () => {
    const event = classifyEvent({
      ray_metadata: { type: "timing", duration_s: 1.5 },
    });
    expect(event).toEqual({ kind: "timing", durationS: 1.5 });
  });

  test("returns null for keepalive metadata", () => {
    expect(classifyEvent({
      ray_metadata: { type: "keepalive" },
    })).toBeNull();
  });

  // --- Tool status ---

  test("classifies tool status event", () => {
    const event = classifyEvent({
      ray_tool: { name: "calculator", status: "running", arguments: { expression: "2+2" } },
    });
    expect(event?.kind).toBe("tool_status");
    if (event?.kind === "tool_status") {
      expect(event.tool.name).toBe("calculator");
      expect(event.tool.status).toBe("running");
    }
  });

  // --- Citations ---

  test("classifies citation event", () => {
    const event = classifyEvent({
      ray_citations: [{ url: "https://example.com", title: "Example" }],
    });
    expect(event?.kind).toBe("citations");
    if (event?.kind === "citations") {
      expect(event.citations).toHaveLength(1);
      expect(event.citations[0].url).toBe("https://example.com");
    }
  });

  // --- Exec confirm ---

  test("classifies exec confirmation", () => {
    const event = classifyEvent({
      type: "exec_confirm",
      pending_id: "abc123",
      full_command: "git status",
      description: "Check git status",
    });
    expect(event).toEqual({
      kind: "exec_confirm",
      pendingId: "abc123",
      command: "git status",
      description: "Check git status",
    });
  });

  // --- Command result ---

  test("classifies command result", () => {
    const event = classifyEvent({
      type: "command_result",
      content: "Bootstrap complete.",
    });
    expect(event).toEqual({
      kind: "command_result",
      content: "Bootstrap complete.",
      action: undefined,
    });
  });

  test("classifies command result with clear action", () => {
    const event = classifyEvent({
      type: "command_result",
      content: "",
      action: "clear",
    });
    expect(event?.kind).toBe("command_result");
    if (event?.kind === "command_result") {
      expect(event.action).toBe("clear");
    }
  });

  // --- Error ---

  test("classifies error event", () => {
    const event = classifyEvent({
      type: "error",
      message: "Rate limited",
      retryable: true,
    });
    expect(event).toEqual({
      kind: "error",
      message: "Rate limited",
      retryable: true,
    });
  });

  test("error defaults retryable to false", () => {
    const event = classifyEvent({ type: "error", message: "Bad request" });
    expect(event?.kind).toBe("error");
    if (event?.kind === "error") {
      expect(event.retryable).toBe(false);
    }
  });

  test("classifies structured error metadata", () => {
    const event = classifyEvent({
      type: "error",
      message: "Something went wrong",
      retryable: false,
      request_id: "req-123",
      tool_name: "calculator",
      round: 2,
      provider: "openai",
      model: "gpt-5-nano",
    });
    expect(event?.kind).toBe("error");
    if (event?.kind === "error") {
      expect(event.requestId).toBe("req-123");
      expect(event.toolName).toBe("calculator");
      expect(event.round).toBe(2);
      expect(event.provider).toBe("openai");
      expect(event.model).toBe("gpt-5-nano");
    }
  });

  test("classifies legacy raw provider error payload", () => {
    const event = classifyEvent({
      error: "API Error",
      message: "Provider exploded",
      status: 500,
    });
    expect(event?.kind).toBe("error");
    if (event?.kind === "error") {
      expect(event.message).toBe("Provider exploded");
      expect(event.retryable).toBe(false);
    }
  });

  // --- Content delta ---

  test("classifies content delta with text", () => {
    const event = classifyEvent({
      choices: [{ delta: { content: "Hello" }, finish_reason: null, index: 0 }],
    });
    expect(event?.kind).toBe("content");
    if (event?.kind === "content") {
      expect(event.text).toBe("Hello");
      expect(event.finishReason).toBeNull();
      expect(event.usage).toBeNull();
    }
  });

  test("classifies finish reason without text", () => {
    const event = classifyEvent({
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
    });
    expect(event?.kind).toBe("content");
    if (event?.kind === "content") {
      expect(event.text).toBe("");
      expect(event.finishReason).toBe("stop");
    }
  });

  test("classifies content with usage data", () => {
    const event = classifyEvent({
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
      usage: { total_tokens: 100, prompt_tokens: 60, completion_tokens: 40 },
    });
    expect(event?.kind).toBe("content");
    if (event?.kind === "content") {
      expect(event.usage).toEqual({ total: 100, prompt: 60, completion: 40 });
    }
  });

  // --- Azure usage-only chunk ---

  test("classifies Azure usage-only chunk (empty choices)", () => {
    const event = classifyEvent({
      choices: [],
      usage: { total_tokens: 50, prompt_tokens: 30, completion_tokens: 20 },
    });
    expect(event?.kind).toBe("content");
    if (event?.kind === "content") {
      expect(event.text).toBe("");
      expect(event.usage).toEqual({ total: 50, prompt: 30, completion: 20 });
    }
  });

  // --- Azure prompt filter (should be ignored) ---

  test("returns null for Azure prompt_filter_results chunk", () => {
    expect(classifyEvent({
      choices: [],
      prompt_filter_results: [{ prompt_index: 0 }],
    })).toBeNull();
  });

  // --- Empty content delta (role-only) ---

  test("returns null for role-only delta with no text or finish_reason", () => {
    expect(classifyEvent({
      choices: [{ delta: { role: "assistant" }, finish_reason: null, index: 0 }],
    })).toBeNull();
  });
});
