import React from "react";
import { RayIcon } from "./RayIcon";
import { usePlatform } from "../context/PlatformContext";

interface HeaderProps {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
}

export function Header({ sidebarVisible, onToggleSidebar }: HeaderProps) {
  const { isDesktop } = usePlatform();

  return (
    <div
      className="h-[44px] border-b border-[var(--border)] flex items-center px-3 bg-[var(--bg-raised)] gap-3"
      style={isDesktop ? { WebkitAppRegion: "drag" } as React.CSSProperties : undefined}
    >
      <button
        onClick={onToggleSidebar}
        className="text-gray-400 hover:text-white p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors"
        style={isDesktop ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : undefined}
        title={sidebarVisible ? "Hide sidebar (Ctrl+.)" : "Show sidebar (Ctrl+.)"}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>
      <RayIcon className="w-5 h-5" />
      <span className="text-sm font-semibold text-white tracking-tight">Ray</span>

      <div
        className="ml-auto flex items-center gap-1"
        style={isDesktop ? { WebkitAppRegion: "no-drag", marginRight: 140 } as React.CSSProperties : undefined}
      >
        <button
          onClick={() => window.location.reload()}
          className="text-gray-400 hover:text-white hover:bg-[var(--bg-hover)] transition-colors p-2 rounded-lg"
          title="Refresh (Ctrl+R)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.36-5.36M20 15a9 9 0 01-15.36 5.36" />
          </svg>
        </button>
      </div>
    </div>
  );
}
