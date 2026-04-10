import React, { useEffect, useRef, useState } from "react";

export interface ToastMessage {
  id: string;
  text: string;
  type: "success" | "error" | "info";
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const typeStyles: Record<ToastMessage["type"], string> = {
  success: "border-green-500/40 bg-green-600/10 text-green-300",
  error: "border-red-500/40 bg-red-600/10 text-red-300",
  info: "border-blue-500/40 bg-blue-600/10 text-blue-300",
};

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      fadeTimerRef.current = setTimeout(() => dismissRef.current(), 300);
    }, 5000);
    return () => {
      clearTimeout(timer);
      clearTimeout(fadeTimerRef.current);
    };
  }, []);

  return (
    <div
      className={`border rounded-lg px-4 py-3 text-sm shadow-lg backdrop-blur-sm transition-all duration-300 ${
        typeStyles[toast.type]
      } ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
    >
      <div className="flex items-start gap-2">
        <span className="flex-1">{toast.text}</span>
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-white shrink-0 ml-2"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-16 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}
