import React, { useState } from "react";
import type { Message, ToolEvent, Citation } from "@/types";
import { parseMessage } from "./MessageParser";
import { ThinkingAnimation } from "./ThinkingAnimation";

interface MessageListProps {
  messages: Message[];
  currentResponse: string;
  streaming: boolean;
  streamTools?: ToolEvent[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  containerRef?: React.RefObject<HTMLDivElement>;
  onRetry?: () => void;
  canRetry?: boolean;
  onResend?: (content: string | any) => void;
}

function StatusIcon({ status }: { status: ToolEvent["status"] }) {
  if (status === "running") {
    return (
      <svg className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    );
  }
  if (status === "success") {
    return (
      <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function formatToolName(name: string): string {
  // mcp__filesystem__read_file -> filesystem / read_file
  if (name.startsWith("mcp__")) {
    const sep = name.indexOf("__", 5);
    if (sep !== -1) return `${name.slice(5, sep)} / ${name.slice(sep + 2)}`;
  }
  return name;
}

function ToolDetail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5">
      <span className="text-[10px] uppercase tracking-wider text-gray-600">{label}</span>
      <pre className="mt-0.5 text-xs font-mono text-gray-400 bg-[var(--bg-deeper)] rounded px-2 py-1.5 overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
        {children}
      </pre>
    </div>
  );
}

function ToolCallItem({ tool, defaultOpen }: { tool: ToolEvent; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasDetail = tool.arguments || tool.result;

  return (
    <div className="border-l-2 border-[var(--border)] pl-3 py-1">
      <button
        onClick={() => hasDetail && setOpen(!open)}
        className={`flex items-center gap-2 text-xs w-full text-left ${hasDetail ? "hover:text-gray-200 cursor-pointer" : "cursor-default"} transition-colors`}
      >
        <StatusIcon status={tool.status} />
        <span className={`font-mono ${tool.status === "error" ? "text-red-400" : "text-gray-300"}`}>
          {formatToolName(tool.name)}
        </span>
        {hasDetail && (
          <svg className={`w-3 h-3 text-gray-600 transition-transform ml-auto ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>
      {open && hasDetail && (
        <div className="ml-5.5 mt-1">
          {tool.arguments && Object.keys(tool.arguments).length > 0 && (
            <ToolDetail label="arguments">
              {JSON.stringify(tool.arguments, null, 2)}
            </ToolDetail>
          )}
          {tool.result && (
            <ToolDetail label={tool.status === "error" ? "error" : "result"}>
              {typeof tool.result === "object" && "result" in tool.result
                ? String(tool.result.result)
                : JSON.stringify(tool.result, null, 2)}
            </ToolDetail>
          )}
        </div>
      )}
    </div>
  );
}

function ToolChips({ tools, live }: { tools: ToolEvent[]; live?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!tools || tools.length === 0) return null;

  let running = 0, failed = 0, done = 0;
  for (const t of tools) {
    if (t.status === "running") running++;
    else if (t.status === "error") failed++;
    else if (t.status === "success") done++;
  }

  let summary: string;
  if (live && running > 0) {
    const current = tools.find((t) => t.status === "running");
    summary = `Running ${formatToolName(current?.name || "tool")}...`;
    if (done > 0) summary += ` (${done} done)`;
  } else {
    summary = `Used ${tools.length} tool${tools.length > 1 ? "s" : ""}`;
    if (failed > 0) summary += ` (${failed} failed)`;
  }

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        {live && running > 0 ? (
          <svg className="w-3 h-3 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
        {summary}
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {tools.map((t, i) => (
            <ToolCallItem key={`${t.name}-${i}`} tool={t} defaultOpen={live || false} />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageActions({
  role,
  content,
  onResend,
}: {
  role: string;
  content: string | any;
  onResend?: (content: string | any) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
      {/* Copy */}
      <button
        onClick={handleCopy}
        className="p-1 text-gray-600 hover:text-gray-300 rounded transition-colors"
        title="Copy"
      >
        {copied ? (
          <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      {/* Resend (user messages only) */}
      {role === "user" && onResend && (
        <button
          onClick={() => onResend(content)}
          className="p-1 text-gray-600 hover:text-gray-300 rounded transition-colors"
          title="Resend"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      )}
    </div>
  );
}

function CitationCards({ citations }: { citations: Citation[] }) {
  // Deduplicate by URL
  const unique = citations.filter((c, i, arr) => arr.findIndex((x) => x.url === c.url) === i);
  return (
    <div className="mt-3 pt-2.5 border-t border-white/10">
      <div className="text-[10px] uppercase tracking-wider text-gray-600 mb-1.5">Sources</div>
      <div className="flex flex-col gap-1">
        {unique.map((c, i) => (
          <a
            key={i}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 text-xs text-gray-500 hover:text-blue-400 transition-colors"
          >
            <span className="flex-shrink-0 text-gray-600 font-mono">{i + 1}.</span>
            <span className="line-clamp-1 break-all">{c.title || c.url}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  currentResponse,
  streaming,
  streamTools = [],
  messagesEndRef,
  containerRef,
  onRetry,
  canRetry,
  onResend,
}: MessageListProps) {
  const renderContent = (content: string | any) => {
    if (typeof content === "string") return parseMessage(content);
    if (!Array.isArray(content)) return parseMessage(String(content ?? ""));
    return (
      <div className="flex flex-col gap-2">
        {content.map((part: any, idx: number) => {
          if (part.type === "text") return <div key={idx}>{parseMessage(part.text || "")}</div>;
          if (part.type === "image_url") return <img key={idx} src={part.image_url?.url} alt="Attached" className="max-w-full rounded-lg mt-2" />;
          return null;
        })}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 bg-[var(--bg-base)] chat-messages">
      <div className="max-w-4xl mx-auto">
        {messages.map((msg, i) => {
          if (msg.role === "system") {
            const isError = typeof msg.content === "string" && msg.content.startsWith("Error:");
            const isLastMessage = i === messages.length - 1;
            return (
              <div key={i} className="mb-4 flex justify-center animate-fadeIn">
                <div className={`px-4 py-2 rounded-lg text-sm ${
                  isError
                    ? "bg-red-600/10 border border-red-500/20 text-red-300"
                    : "bg-blue-600/10 border border-blue-500/20 text-gray-300 rounded-full"
                }`}>
                  {renderContent(msg.content)}
                  {isError && isLastMessage && canRetry && onRetry && (
                    <button
                      onClick={onRetry}
                      className="ml-3 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-1 transition-colors"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            );
          }


          const hasContent = typeof msg.content === "string" ? msg.content.trim() !== "" : Array.isArray(msg.content) && msg.content.length > 0;

          return (
            <div key={i} className={`mb-4 animate-fadeIn group ${msg.role === "user" ? "text-right" : "text-left"}`}>
              <div className={`inline-block max-w-[80%] lg:max-w-[65%] min-w-0 overflow-hidden`}>
                {/* Tool chips for assistant messages */}
                {msg.role === "assistant" && msg.tools && <ToolChips tools={msg.tools} />}
                {hasContent && (
                  <div className={`p-4 rounded-lg text-left message-content ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-[#2d394b] to-[#273448] shadow-lg"
                      : "bg-gradient-to-br from-[var(--bg-surface)] to-[#1d2127] shadow-lg"
                  }`}>
                    {renderContent(msg.content)}
                    {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                      <CitationCards citations={msg.citations} />
                    )}
                  </div>
                )}
                {hasContent && <MessageActions role={msg.role} content={msg.content} onResend={onResend} />}
              </div>
            </div>
          );
        })}

        {streaming && !currentResponse && streamTools.length === 0 && (
          <div className="mb-4 animate-fadeIn">
            <ThinkingAnimation />
          </div>
        )}

        {/* Streaming tool events */}
        {streaming && streamTools.length > 0 && !currentResponse && (
          <div className="mb-4 animate-fadeIn">
            <ToolChips tools={streamTools} live />
            <ThinkingAnimation />
          </div>
        )}

        {currentResponse && (
          <div className="mb-4 animate-fadeIn">
            {streamTools.length > 0 && <ToolChips tools={streamTools} live={streaming} />}
            <div className="inline-block bg-gradient-to-br from-[var(--bg-surface)] to-[#1d2127] p-4 rounded-lg max-w-[80%] lg:max-w-[65%] min-w-0 overflow-hidden message-content shadow-lg">
              {parseMessage(currentResponse)}
              {streaming && <span className="text-blue-400 opacity-70 ml-1 animate-pulse">|</span>}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
