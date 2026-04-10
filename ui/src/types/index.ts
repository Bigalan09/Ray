export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface ToolEvent {
  name: string;
  status: 'running' | 'success' | 'error';
  arguments?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export interface Citation {
  url: string;
  title: string;
  start_index?: number | null;
  end_index?: number | null;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContent[];
  metadata?: Record<string, any>;
  tools?: ToolEvent[];
  citations?: Citation[];
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
}

export interface Prompt {
  title: string;
  content: string;
  temperature: number;
}

export interface Model {
  id: string;
  model: string;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  enabled: boolean;
}
