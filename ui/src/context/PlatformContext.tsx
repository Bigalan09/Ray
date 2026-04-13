import React, { createContext, useContext, useMemo } from "react";

interface PlatformState {
  /** True when running inside Electron (desktop app). */
  isDesktop: boolean;
  /** True when running in a regular browser tab. */
  isWeb: boolean;
}

const PlatformContext = createContext<PlatformState>({
  isDesktop: false,
  isWeb: true,
});

function detectDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes("Electron");
}

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<PlatformState>(() => {
    const isDesktop = detectDesktop();
    return { isDesktop, isWeb: !isDesktop };
  }, []);

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformState {
  return useContext(PlatformContext);
}
