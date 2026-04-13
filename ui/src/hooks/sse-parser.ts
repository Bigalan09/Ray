/**
 * Buffered SSE line parser.
 *
 * Handles the case where a single SSE event spans multiple TCP chunks.
 * Accumulates text in a buffer and only yields complete "data: ..." lines
 * with the prefix stripped.
 */
export class SSELineParser {
  private buffer = "";
  private decoder = new TextDecoder();

  /**
   * Feed raw bytes from a ReadableStream chunk.
   * Returns an array of complete SSE data payloads (without the "data: " prefix).
   * Returns an empty array if no complete lines are available yet.
   */
  feed(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const lines = this.buffer.split("\n");
    // The last element may be incomplete; keep it in the buffer.
    this.buffer = lines.pop() ?? "";
    return this.extractPayloads(lines);
  }

  /**
   * Flush any remaining buffer content after the stream ends.
   * Call this when the reader reports done to process any trailing data.
   */
  flush(): string[] {
    if (!this.buffer) return [];
    const remaining = this.buffer;
    this.buffer = "";
    return this.extractPayloads([remaining]);
  }

  private extractPayloads(lines: string[]): string[] {
    const payloads: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      payloads.push(data);
    }
    return payloads;
  }
}
