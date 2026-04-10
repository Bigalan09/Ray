import React, { useRef, useState } from "react";

interface FileUploadProps {
  onFileUploaded: (result: any) => void;
  disabled?: boolean;
}

export function FileUpload({ onFileUploaded, disabled }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const resp = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });
        const result = await resp.json();
        onFileUploaded({ ...result, filename: file.name });
      } catch (err) {
        console.error("Upload failed:", err);
        onFileUploaded({ error: "Upload failed", filename: file.name });
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.csv,.json,.yaml,.yml,.py,.js,.ts"
        onChange={handleFileSelect}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
        className="bg-[var(--bg-badge)] hover:bg-[var(--bg-hover)] text-gray-300 hover:text-white rounded-lg px-2.5 py-2 text-sm transition-colors disabled:opacity-50"
        title={uploading ? "Uploading..." : "Upload document for RAG"}
      >
        {uploading ? "..." : "+"}
      </button>
    </>
  );
}
