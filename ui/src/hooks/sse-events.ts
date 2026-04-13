import type { ToolEvent, Citation } from "@/types";

export interface TokenUsage {
  total: number;
  prompt: number;
  completion: number;
}

export type SSEEvent =
  | { kind: "content"; text: string; finishReason: string | null; usage: TokenUsage | null }
  | { kind: "tool_status"; tool: ToolEvent }
  | { kind: "citations"; citations: Citation[] }
  | { kind: "exec_confirm"; pendingId: string; command: string; description: string }
  | { kind: "command_result"; content: string; action?: string }
  | {
      kind: "error";
      message: string;
      retryable: boolean;
      requestId?: string;
      toolName?: string;
      round?: number;
      provider?: string;
      model?: string;
    }
  | { kind: "timing"; durationS: number };

/**
 * Classify a raw parsed JSON object from the SSE stream into a typed event.
 * Returns null for unrecognised shapes (keepalives, unknown metadata, etc.).
 */
export function classifyEvent(raw: any): SSEEvent | null {
  if (!raw || typeof raw !== "object") return null;

  // Metadata (timing, keepalive)
  if (raw.ray_metadata) {
    if (raw.ray_metadata.type === "timing") {
      return { kind: "timing", durationS: raw.ray_metadata.duration_s };
    }
    return null; // keepalive or unknown metadata
  }

  // Tool status event
  if (raw.ray_tool) {
    return { kind: "tool_status", tool: raw.ray_tool as ToolEvent };
  }

  // Citations from web_search_preview
  if (raw.ray_citations) {
    return { kind: "citations", citations: raw.ray_citations as Citation[] };
  }

  // Exec confirmation
  if (raw.type === "exec_confirm") {
    return {
      kind: "exec_confirm",
      pendingId: raw.pending_id,
      command: raw.full_command,
      description: raw.description || "",
    };
  }

  // Slash command result
  if (raw.type === "command_result") {
    return {
      kind: "command_result",
      content: raw.content || "",
      action: raw.action,
    };
  }

  // Backend error
  if (raw.type === "error") {
    return {
      kind: "error",
      message: raw.message || "Unknown error",
      retryable: !!raw.retryable,
      requestId: raw.request_id,
      toolName: raw.tool_name,
      round: raw.round,
      provider: raw.provider,
      model: raw.model,
    };
  }

  if (raw.error) {
    return {
      kind: "error",
      message: raw.message || raw.error || "Unknown error",
      retryable: false,
    };
  }

  // Content delta (OpenAI-compatible streaming chunk)
  const choices = raw.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    const text = choice?.delta?.content || "";
    const finishReason: string | null = choice?.finish_reason ?? null;

    let usage: TokenUsage | null = null;
    if (raw.usage) {
      usage = {
        total: raw.usage.total_tokens || 0,
        prompt: raw.usage.prompt_tokens || 0,
        completion: raw.usage.completion_tokens || 0,
      };
    }

    // Only emit if there's text, a finish reason, or usage data
    if (text || finishReason || usage) {
      return { kind: "content", text, finishReason, usage };
    }
  }

  // Usage-only chunk (Azure sends choices:[] with usage in a separate chunk)
  if (raw.usage && Array.isArray(raw.choices) && raw.choices.length === 0) {
    return {
      kind: "content",
      text: "",
      finishReason: null,
      usage: {
        total: raw.usage.total_tokens || 0,
        prompt: raw.usage.prompt_tokens || 0,
        completion: raw.usage.completion_tokens || 0,
      },
    };
  }

  return null;
}
