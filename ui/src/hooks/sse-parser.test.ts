import { describe, test, expect } from "bun:test";
import { SSELineParser } from "./sse-parser";

const encode = (s: string) => new TextEncoder().encode(s);

describe("SSELineParser", () => {
  test("parses a single complete chunk", () => {
    const parser = new SSELineParser();
    const payloads = parser.feed(encode('data: {"text":"hello"}\n'));
    expect(payloads).toEqual(['{"text":"hello"}']);
  });

  test("parses multiple lines in one chunk", () => {
    const parser = new SSELineParser();
    const payloads = parser.feed(encode(
      'data: {"a":1}\ndata: {"b":2}\n'
    ));
    expect(payloads).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("buffers partial lines across chunks", () => {
    const parser = new SSELineParser();
    // First chunk ends mid-line
    const p1 = parser.feed(encode('data: {"par'));
    expect(p1).toEqual([]);
    // Second chunk completes the line
    const p2 = parser.feed(encode('tial":"yes"}\n'));
    expect(p2).toEqual(['{"partial":"yes"}']);
  });

  test("ignores non-data lines", () => {
    const parser = new SSELineParser();
    const payloads = parser.feed(encode(
      ': comment\nevent: message\ndata: {"ok":true}\n\n'
    ));
    expect(payloads).toEqual(['{"ok":true}']);
  });

  test("ignores [DONE] marker", () => {
    const parser = new SSELineParser();
    const payloads = parser.feed(encode(
      'data: {"last":true}\ndata: [DONE]\n'
    ));
    expect(payloads).toEqual(['{"last":true}']);
  });

  test("handles empty chunks", () => {
    const parser = new SSELineParser();
    expect(parser.feed(encode(""))).toEqual([]);
    expect(parser.feed(encode("\n\n"))).toEqual([]);
  });

  test("flush returns remaining buffered data", () => {
    const parser = new SSELineParser();
    parser.feed(encode('data: {"buffered":true}'));
    // No newline, so nothing returned yet
    expect(parser.flush()).toEqual(['{"buffered":true}']);
  });

  test("flush returns empty for empty buffer", () => {
    const parser = new SSELineParser();
    expect(parser.flush()).toEqual([]);
  });

  test("handles Azure-style multi-chunk SSE", () => {
    const parser = new SSELineParser();

    // Azure sends prompt_filter_results first
    const p1 = parser.feed(encode(
      'data: {"choices":[],"prompt_filter_results":[{}]}\n\n'
    ));
    expect(p1).toEqual(['{"choices":[],"prompt_filter_results":[{}]}']);

    // Then content chunks
    const p2 = parser.feed(encode(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
    ));
    expect(p2).toEqual(['{"choices":[{"delta":{"content":"Hello"}}]}']);

    // Then [DONE]
    const p3 = parser.feed(encode('data: [DONE]\n'));
    expect(p3).toEqual([]);
  });

  test("handles lines split across three chunks", () => {
    const parser = new SSELineParser();
    expect(parser.feed(encode("dat"))).toEqual([]);
    expect(parser.feed(encode("a: {\"x\""))).toEqual([]);
    expect(parser.feed(encode(":1}\n"))).toEqual(['{"x":1}']);
  });
});
