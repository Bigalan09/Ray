import React, { useState, useCallback } from "react";
import { FileUpload } from "./FileUpload";
import { CommandAutocomplete } from "./CommandAutocomplete";

export interface ImageAttachment {
  id: string;
  dataUrl: string;
  name: string;
}

export interface ExecPendingState {
  pending_id: string;
  command: string;
  description: string;
}

interface InputFormProps {
  input: string;
  streaming: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onFileUploaded: (result: any) => void;
  attachments: ImageAttachment[];
  onAddAttachment: (attachment: ImageAttachment) => void;
  onRemoveAttachment: (id: string) => void;
  execPending?: ExecPendingState | null;
  onExecApprove?: () => void;
  onExecDeny?: () => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function InputForm({
  input,
  streaming,
  textareaRef,
  onInputChange,
  onKeyDown,
  onSubmit,
  onStop,
  onFileUploaded,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  execPending,
  onExecApprove,
  onExecDeny,
}: InputFormProps) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const commandFilter = input.startsWith("/") && !input.includes("\n") ? input : "";

  const handleInputChangeWrapped = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(e);
    const val = e.target.value;
    setShowAutocomplete(val.startsWith("/") && !val.includes("\n") && !val.includes(" "));
  };

  const handleCommandSelect = (command: string) => {
    const syntheticEvent = {
      target: { value: command },
    } as React.ChangeEvent<HTMLTextAreaElement>;
    onInputChange(syntheticEvent);
    setShowAutocomplete(false);
    textareaRef.current?.focus();
  };

  const handleKeyDownWrapped = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAutocomplete && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab")) {
      return;
    }
    if (showAutocomplete && e.key === "Escape") {
      setShowAutocomplete(false);
      return;
    }
    onKeyDown(e);
  };

  const addImageFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      if (!isImageFile(file)) continue;
      if (file.size > 20 * 1024 * 1024) continue;
      const dataUrl = await fileToDataUrl(file);
      onAddAttachment({
        id: crypto.randomUUID(),
        dataUrl,
        name: file.name,
      });
    }
  }, [onAddAttachment]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((i) => i.type.startsWith("image/"));
    if (imageItems.length === 0) return;

    e.preventDefault();
    const files = imageItems.map((i) => i.getAsFile()).filter(Boolean) as File[];
    await addImageFiles(files);
  }, [addImageFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(isImageFile);
    if (files.length > 0) {
      await addImageFiles(files);
    } else {
      // Non-image files go through the RAG upload
      for (const file of Array.from(e.dataTransfer.files)) {
        const formData = new FormData();
        formData.append("file", file);
        try {
          const resp = await fetch("/api/documents/upload", { method: "POST", body: formData });
          const result = await resp.json();
          onFileUploaded({ ...result, filename: file.name });
        } catch {
          onFileUploaded({ error: "Upload failed", filename: file.name });
        }
      }
    }
  }, [addImageFiles, onFileUploaded]);

  const hasContent = input.trim() || attachments.length > 0;

  // Exec approval bar replaces the normal input
  if (execPending) {
    return (
      <div className="border-t border-[var(--border)] p-3 bg-[var(--bg-raised)]">
        <div className="w-full max-w-4xl mx-auto">
          <div className="flex items-center gap-3 bg-[var(--bg-input)] rounded-lg px-4 py-3">
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-400 mb-0.5">Allow Ray to run command?</div>
              <code className="text-sm text-blue-300 font-mono">{execPending.command}</code>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={onExecDeny}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--bg-deeper)] hover:bg-red-500/30 text-gray-400 hover:text-red-200 border border-[var(--border)] transition-colors"
              >
                Deny
              </button>
              <button
                type="button"
                onClick={onExecApprove}
                className="px-4 py-1.5 text-xs font-medium rounded-md bg-green-600/80 hover:bg-green-500 text-white transition-colors"
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      className="border-t border-[var(--border)] p-3 bg-[var(--bg-raised)]"
      onSubmit={onSubmit}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="w-full max-w-4xl mx-auto">
        {/* Attachment preview strip */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachments.map((att) => (
              <div key={att.id} className="relative">
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="h-16 w-16 object-cover rounded-lg border border-[var(--border)]"
                />
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-md"
                  title="Remove"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Drag overlay */}
        {dragOver && (
          <div className="mb-2 border-2 border-dashed border-blue-500/50 rounded-lg p-4 text-center text-sm text-blue-400">
            Drop images or files here
          </div>
        )}

        <div className="flex gap-2 items-center relative">
          <FileUpload onFileUploaded={onFileUploaded} disabled={streaming} />
          <div className="flex-1 relative">
            <CommandAutocomplete
              filter={commandFilter}
              onSelect={handleCommandSelect}
              onClose={() => setShowAutocomplete(false)}
              visible={showAutocomplete}
            />
            <textarea
              ref={textareaRef}
              className="w-full bg-[var(--bg-input)] text-white border-none rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[40px] max-h-[200px] overflow-y-auto"
              value={input}
              onChange={handleInputChangeWrapped}
              onKeyDown={handleKeyDownWrapped}
              onPaste={handlePaste}
              placeholder="How can I assist you today?"
              disabled={streaming}
              autoFocus
              rows={1}
            />
          </div>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 font-semibold text-sm transition-all"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white rounded-lg px-5 py-2 font-semibold text-sm transition-all shadow-lg shadow-blue-500/30 disabled:opacity-50"
              disabled={!hasContent}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
