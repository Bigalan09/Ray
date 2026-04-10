import React, { useState } from "react";
import { parseMessage } from "./MessageParser";

interface ExecConfirmProps {
  pendingId: string;
  command: string;
  description?: string;
  onResult?: (command: string, output: string) => void;
}

type ConfirmState = "idle" | "executing" | "completed" | "denied" | "expired";

interface ExecOutput {
  content: string;
  expired?: boolean;
  data?: {
    exit_code: number;
    stdout: string;
    stderr: string;
    timed_out: boolean;
    truncated: boolean;
    duration_ms: number;
  };
  error?: boolean;
}

export function ExecConfirm({
  pendingId,
  command,
  description,
  onResult,
}: ExecConfirmProps) {
  const [state, setState] = useState<ConfirmState>("idle");
  const [output, setOutput] = useState<ExecOutput | null>(null);

  const handleApprove = async () => {
    setState("executing");
    try {
      const res = await fetch("/api/exec/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_id: pendingId }),
      });
      const data = await res.json();
      if (data.expired) {
        setState("expired");
      } else {
        setState("completed");
        setOutput(data);
        // Notify parent so the result enters the conversation for the LLM
        if (onResult && data.data) {
          const parts: string[] = [];
          if (data.data.stdout) parts.push(data.data.stdout.trim());
          if (data.data.stderr) parts.push("stderr: " + data.data.stderr.trim());
          onResult(command, parts.join("\n") || "(no output)");
        }
      }
    } catch {
      setState("expired");
      setOutput({ content: "Failed to communicate with the server.", error: true });
    }
  };

  const handleDeny = async () => {
    setState("denied");
    try {
      await fetch("/api/exec/deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_id: pendingId }),
      });
    } catch {
      // Denial is best-effort; the pending entry will expire anyway.
    }
  };

  return (
    <div className="inline-block max-w-[80%] lg:max-w-[65%]">
      <div className="bg-gradient-to-br from-[var(--bg-surface)] to-[#1d2127] rounded-lg shadow-lg overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <code className="text-sm text-blue-300 font-mono truncate">{command}</code>
            {description && (
              <span className="text-xs text-gray-500 flex-shrink-0">{description}</span>
            )}
          </div>

          {state === "idle" && (
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={handleApprove}
                className="px-3 py-1 text-xs font-medium rounded-md bg-green-600/80 hover:bg-green-500 text-white transition-colors"
              >
                Run
              </button>
              <button
                onClick={handleDeny}
                className="px-3 py-1 text-xs font-medium rounded-md bg-[var(--bg-deeper)] hover:bg-red-500/30 text-gray-400 hover:text-red-200 border border-[var(--border)] transition-colors"
              >
                Deny
              </button>
            </div>
          )}

          {state === "executing" && (
            <div className="flex items-center gap-2 text-xs text-blue-400 flex-shrink-0">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running...
            </div>
          )}

          {state === "denied" && (
            <span className="text-xs text-gray-500 flex-shrink-0">Denied</span>
          )}

          {state === "expired" && (
            <span className="text-xs text-amber-400 flex-shrink-0">Expired</span>
          )}

          {state === "completed" && output?.data && (
            <span className="text-xs text-gray-500 flex-shrink-0">
              Exit {output.data.exit_code} &middot; {output.data.duration_ms}ms
              {output.data.timed_out && <span className="text-amber-400 ml-1">timed out</span>}
            </span>
          )}
        </div>
      </div>

      {state === "completed" && output?.data && (output.data.stdout || output.data.stderr) && (
        <div className="mt-2 p-4 rounded-lg text-left message-content bg-gradient-to-br from-[var(--bg-surface)] to-[#1d2127] shadow-lg">
          {output.data.stdout && parseMessage("```\n" + output.data.stdout.trim() + "\n```")}
          {output.data.stderr && (
            <div className="mt-2">
              {parseMessage("**stderr:**\n```\n" + output.data.stderr.trim() + "\n```")}
            </div>
          )}
          {output.data.truncated && (
            <p className="text-xs text-amber-400 mt-2">Output was truncated.</p>
          )}
        </div>
      )}

      {state === "completed" && output && !output.data && output.content && (
        <div className="mt-2 p-4 rounded-lg text-left message-content bg-gradient-to-br from-[var(--bg-surface)] to-[#1d2127] shadow-lg">
          {parseMessage(output.content)}
        </div>
      )}
    </div>
  );
}
