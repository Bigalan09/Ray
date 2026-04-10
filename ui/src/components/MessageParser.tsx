import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

export function parseMessage(text: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1({node, ...props}) {
          return <h1 className="text-3xl font-bold mt-6 mb-4 text-[var(--text-heading)] border-b border-[var(--border)] pb-2" {...props} />;
        },
        h2({node, ...props}) {
          return <h2 className="text-2xl font-bold mt-5 mb-3 text-[var(--text-heading)]" {...props} />;
        },
        h3({node, ...props}) {
          return <h3 className="text-xl font-semibold mt-4 mb-2 text-[var(--text-heading)]" {...props} />;
        },
        h4({node, ...props}) {
          return <h4 className="text-lg font-semibold mt-3 mb-2 text-[var(--text-primary)]" {...props} />;
        },
        h5({node, ...props}) {
          return <h5 className="text-base font-semibold mt-2 mb-1 text-[var(--text-primary)]" {...props} />;
        },
        h6({node, ...props}) {
          return <h6 className="text-sm font-semibold mt-2 mb-1 text-[var(--text-muted)]" {...props} />;
        },
        p({node, ...props}) {
          return <p className="my-3 leading-7 text-[var(--text-primary)]" {...props} />;
        },
        blockquote({node, ...props}) {
          return <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-4 bg-[var(--bg-badge)] rounded-r text-gray-300 italic" {...props} />;
        },
        ul({node, ...props}) {
          return <ul className="list-disc list-outside ml-6 my-3 space-y-1.5 text-[var(--text-primary)]" {...props} />;
        },
        ol({node, ...props}) {
          return <ol className="list-decimal list-outside ml-6 my-3 space-y-1.5 text-[var(--text-primary)]" {...props} />;
        },
        li({node, ...props}) {
          return <li className="leading-7 pl-1" {...props} />;
        },
        a({node, ...props}) {
          return <a className="text-blue-400 hover:text-blue-300 underline decoration-blue-500/50 hover:decoration-blue-300 transition-colors duration-200" target="_blank" rel="noopener noreferrer" {...props} />;
        },
        hr({node, ...props}) {
          return <hr className="my-6 border-t border-[var(--border)]" {...props} />;
        },
        strong({node, children, ...props}) {
          const text = String(children);
          if (text.startsWith("Tool:")) {
            const toolName = text.slice(5).trim();
            return (
              <span className="inline-flex items-center gap-1">
                <span className="text-xs bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded font-mono">Tool</span>
                <strong className="font-semibold text-[var(--text-heading)]">{toolName}</strong>
              </span>
            );
          }
          return <strong className="font-semibold text-[var(--text-heading)]" {...props}>{children}</strong>;
        },
        em({node, ...props}) {
          return <em className="italic text-[var(--text-primary)]" {...props} />;
        },
        code({node, inline, className, children, ...props}) {
          const match = /language-(\w+)/.exec(className || "");
          const isCodeBlock = inline === false || (className && /language-/.test(className));

          return isCodeBlock ? (
            <CodeBlock
              code={String(children).replace(/\n$/, "")}
              language={match ? match[1] : "text"}
            />
          ) : (
            <code className="bg-[var(--bg-badge)] text-amber-300 px-1.5 py-0.5 rounded text-[0.9em] font-mono border border-[var(--border)]" {...props}>{children}</code>
          );
        },
        table({node, ...props}) {
          return <div className="overflow-x-auto my-4"><table className="border-collapse border border-[var(--border)] w-full text-left rounded-lg overflow-hidden" {...props} /></div>;
        },
        thead({node, ...props}) {
          return <thead className="bg-[var(--bg-badge)]" {...props} />;
        },
        th({node, ...props}) {
          return <th className="border border-[var(--border)] px-4 py-2 font-semibold text-[var(--text-heading)]" {...props} />;
        },
        td({node, ...props}) {
          return <td className="border border-[var(--border)] px-4 py-2 text-[var(--text-primary)]" {...props} />;
        },
        tr({node, ...props}) {
          return <tr className="hover:bg-[var(--bg-badge)] transition-colors duration-150" {...props} />;
        },
        pre({node, ...props}) {
          return <pre className="overflow-x-auto" {...props} />;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
