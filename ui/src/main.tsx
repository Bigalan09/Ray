import React from "react";
import { createRoot } from "react-dom/client";
import { PlatformProvider } from "./context/PlatformContext";
import App from "./App";

const root = createRoot(document.getElementById("root")!);
root.render(
  <PlatformProvider>
    <App />
  </PlatformProvider>
);
