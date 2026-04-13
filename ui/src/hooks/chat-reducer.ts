import type { Message, ToolEvent, Citation, Model } from "@/types";
import type { ExecPendingState } from "@/components/InputForm";
import type { TokenUsage } from "./sse-events";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type ChatPhase = "idle" | "sending" | "streaming" | "committing" | "error";

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface ChatState {
  phase: ChatPhase;
  messages: Message[];
  currentResponse: string;
  streamTools: ToolEvent[];
  streamCitations: Citation[];
  tokens: TokenUsage;
  duration: number | null;
  conversations: Conversation[];
  taskConversations: Conversation[];
  activeConversationId: string | null;
  models: Model[];
  selectedModel: string;
  execPending: ExecPendingState | null;
  bootstrapping: boolean;
  retryContext: { messages: Message[]; convId: string | null } | null;
}

export const initialChatState: ChatState = {
  phase: "idle",
  messages: [],
  currentResponse: "",
  streamTools: [],
  streamCitations: [],
  tokens: { total: 0, prompt: 0, completion: 0 },
  duration: null,
  conversations: [],
  taskConversations: [],
  activeConversationId: null,
  models: [],
  selectedModel: "",
  execPending: null,
  bootstrapping: false,
  retryContext: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ChatAction =
  | { type: "SEND_START"; userMessage: Message; bootstrapping?: boolean }
  | { type: "STREAM_CHUNK"; fullText: string }
  | { type: "STREAM_TOOL"; tool: ToolEvent }
  | { type: "STREAM_CITATIONS"; citations: Citation[] }
  | { type: "STREAM_USAGE"; tokens: TokenUsage }
  | { type: "STREAM_TIMING"; durationS: number }
  | { type: "STREAM_END"; finalText: string; tools?: ToolEvent[]; citations?: Citation[] }
  | { type: "STREAM_ERROR"; message: string; retryable: boolean; retryMessages?: Message[]; retryConvId?: string | null }
  | { type: "COMMAND_RESULT"; content: string; action?: string }
  | { type: "EXEC_CONFIRM"; pendingId: string; command: string; description: string }
  | { type: "EXEC_RESOLVE" }
  | { type: "STOP"; partialText?: string }
  | { type: "COMMIT_DONE"; conversations: Conversation[]; taskConversations: Conversation[] }
  | { type: "SELECT_CONVERSATION"; id: string; messages: Message[] }
  | { type: "NEW_CHAT" }
  | { type: "DELETE_CONVERSATION"; id: string; conversations: Conversation[]; taskConversations: Conversation[] }
  | { type: "DELETE_ALL"; conversations: Conversation[]; taskConversations: Conversation[] }
  | { type: "SET_CONVERSATIONS"; conversations: Conversation[]; taskConversations: Conversation[] }
  | { type: "SET_MODELS"; models: Model[] }
  | { type: "SET_MODEL"; id: string }
  | { type: "RETRY" }
  | { type: "REGENERATE" };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SEND_START": {
      if (state.phase !== "idle") return state;
      return {
        ...state,
        phase: "sending",
        messages: [...state.messages, action.userMessage],
        currentResponse: "",
        streamTools: [],
        streamCitations: [],
        tokens: { total: 0, prompt: 0, completion: 0 },
        duration: null,
        execPending: null,
        bootstrapping: action.bootstrapping ?? false,
        retryContext: null,
      };
    }

    case "STREAM_CHUNK": {
      const phase = state.phase === "sending" ? "streaming" : state.phase;
      if (phase !== "streaming") return state;
      return { ...state, phase, currentResponse: action.fullText };
    }

    case "STREAM_TOOL": {
      const phase = state.phase === "sending" ? "streaming" : state.phase;
      if (phase !== "streaming") return state;
      const tool = action.tool;
      const prev = state.streamTools.find(
        (t) => t.name === tool.name && t.status === "running",
      );
      if (prev && tool.status !== "running") {
        tool.arguments = tool.arguments || prev.arguments;
      }
      const updated = [
        ...state.streamTools.filter(
          (t) => !(t.name === tool.name && t.status === "running"),
        ),
        tool,
      ];
      return { ...state, phase, streamTools: updated };
    }

    case "STREAM_CITATIONS":
      return { ...state, streamCitations: action.citations };

    case "STREAM_USAGE":
      return { ...state, tokens: action.tokens };

    case "STREAM_TIMING":
      return { ...state, duration: action.durationS };

    case "STREAM_END": {
      if (state.phase !== "streaming" && state.phase !== "sending") return state;
      const assistantMsg: Message | null = action.finalText
        ? {
            role: "assistant",
            content: action.finalText,
            tools: action.tools,
            citations: action.citations,
          }
        : action.tools?.length
          ? { role: "assistant", content: "", tools: action.tools }
          : null;
      return {
        ...state,
        phase: "committing",
        messages: assistantMsg ? [...state.messages, assistantMsg] : state.messages,
        currentResponse: "",
        streamTools: [],
        streamCitations: [],
        bootstrapping: false,
      };
    }

    case "STREAM_ERROR": {
      return {
        ...state,
        phase: "idle",
        currentResponse: "",
        streamTools: [],
        bootstrapping: false,
        messages: [
          ...state.messages,
          { role: "system", content: `Error: ${action.message}` },
        ],
        retryContext: action.retryable
          ? { messages: action.retryMessages ?? [], convId: action.retryConvId ?? null }
          : null,
      };
    }

    case "COMMAND_RESULT": {
      if (action.action === "clear") {
        return { ...state, messages: [], activeConversationId: null };
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "assistant", content: action.content },
        ],
      };
    }

    case "EXEC_CONFIRM":
      return {
        ...state,
        execPending: {
          pending_id: action.pendingId,
          command: action.command,
          description: action.description,
        },
      };

    case "EXEC_RESOLVE":
      return { ...state, execPending: null };

    case "STOP": {
      if (state.phase !== "streaming" && state.phase !== "sending") return state;
      const partial = action.partialText;
      const msgs = partial
        ? [...state.messages, { role: "assistant" as const, content: partial }]
        : state.messages;
      return {
        ...state,
        phase: "idle",
        messages: msgs,
        currentResponse: "",
        streamTools: [],
        bootstrapping: false,
      };
    }

    case "COMMIT_DONE":
      return {
        ...state,
        phase: "idle",
        conversations: action.conversations,
        taskConversations: action.taskConversations,
      };

    case "SELECT_CONVERSATION": {
      if (state.phase !== "idle") return state;
      return {
        ...state,
        activeConversationId: action.id,
        messages: action.messages,
        currentResponse: "",
        duration: null,
        tokens: { total: 0, prompt: 0, completion: 0 },
      };
    }

    case "NEW_CHAT":
      return {
        ...state,
        activeConversationId: null,
        messages: [],
        currentResponse: "",
        duration: null,
        tokens: { total: 0, prompt: 0, completion: 0 },
      };

    case "DELETE_CONVERSATION": {
      const wasActive = state.activeConversationId === action.id;
      return {
        ...state,
        conversations: action.conversations,
        taskConversations: action.taskConversations,
        activeConversationId: wasActive ? null : state.activeConversationId,
        messages: wasActive ? [] : state.messages,
      };
    }

    case "DELETE_ALL":
      return {
        ...state,
        conversations: action.conversations,
        taskConversations: action.taskConversations,
        activeConversationId: null,
        messages: [],
      };

    case "SET_CONVERSATIONS":
      return {
        ...state,
        conversations: action.conversations,
        taskConversations: action.taskConversations,
      };

    case "SET_MODELS": {
      const selected = action.models.length > 0 ? action.models[0].id : "";
      return { ...state, models: action.models, selectedModel: selected };
    }

    case "SET_MODEL":
      return { ...state, selectedModel: action.id };

    case "RETRY": {
      if (!state.retryContext || state.phase !== "idle") return state;
      return {
        ...state,
        phase: "sending",
        currentResponse: "",
        streamTools: [],
        retryContext: null,
      };
    }

    case "REGENERATE": {
      if (state.phase !== "idle" || state.messages.length === 0) return state;
      // Strip trailing assistant/system messages to get back to the last user message
      const msgs = [...state.messages];
      while (msgs.length > 0 && msgs[msgs.length - 1].role !== "user") {
        msgs.pop();
      }
      if (msgs.length === 0) return state;
      return {
        ...state,
        phase: "sending",
        messages: msgs,
        currentResponse: "",
        streamTools: [],
        streamCitations: [],
        tokens: { total: 0, prompt: 0, completion: 0 },
        duration: null,
        retryContext: null,
      };
    }

    default:
      return state;
  }
}
