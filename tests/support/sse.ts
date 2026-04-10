export interface SSEEvent {
  type?: string;
  content?: string;
  choices?: { delta: { content?: string }; index: number }[];
  [key: string]: unknown;
}

export function parseSSE<T extends SSEEvent = SSEEvent>(raw: string): T[] {
  const events: T[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;

    const data = trimmed.slice(6);
    if (data === "[DONE]") continue;

    try {
      events.push(JSON.parse(data) as T);
    } catch {
      // Ignore non-JSON events.
    }
  }

  return events;
}

export function extractContent(events: SSEEvent[]): string {
  let text = "";

  for (const event of events) {
    if (event.type === "command_result" && event.content) {
      text += event.content;
    }

    const delta = event.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
    }
  }

  return text;
}
