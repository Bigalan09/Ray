import React from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = "typescript", className }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const fallbackCopyTextToClipboard = (text: string): boolean => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      return successful;
    } catch (err) {
      console.error("Fallback copy failed", err);
      return false;
    }
  };

  const handleCopy = async () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
      } catch (err) {
        console.warn("Clipboard API failed, trying fallback", err);
        const ok = fallbackCopyTextToClipboard(code);
        if (ok) setCopied(true);
        else console.error("Copy failed (clipboard + fallback)");
      }
    } else {
      const ok = fallbackCopyTextToClipboard(code);
      if (ok) setCopied(true);
      else console.error("Copy not supported");
    }

    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  return (
    <div
      className={`relative my-6 rounded-lg border border-[var(--border)] bg-[var(--bg-deeper)] font-mono text-sm overflow-hidden shadow-lg shadow-black/30 hover:shadow-black/40 transition-shadow duration-200 ${className ?? ""}`}
      role="region"
      aria-label={`Code snippet in ${language}`}
    >
      <div className="max-h-96 overflow-y-auto overflow-x-auto custom-scrollbar">
        <div
          className="sticky top-0 z-10 flex justify-between items-center px-4 py-2.5 bg-[var(--bg-deeper)] border-b border-[var(--border)]"
        >
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider bg-[var(--bg-badge)] px-2 py-1 rounded-lg">{language}</span>

          <button
            onClick={handleCopy}
            type="button"
            aria-label={copied ? "Copied to clipboard" : "Copy code to clipboard"}
            aria-live="polite"
            className={`text-xs px-3 py-1.5 rounded-lg transition-all duration-200 ease-in-out font-medium
              ${
                copied
                  ? "bg-green-500 text-white shadow-lg shadow-green-500/30"
                  : "bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 hover:text-white"
              }
            `}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{
            background: "transparent",
            margin: 0,
            padding: "1.25rem",
            minWidth: "100%",
          }}
          codeTagProps={{
            style: { fontFamily: '"Fira Code", "Cascadia Code", monospace' },
          }}
          showLineNumbers={false}
          wrapLongLines={true}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
