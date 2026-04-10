import { defineConfig } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env from repo root
const envFile = resolve(__dirname, "../.env");
const envVars: Record<string, string> = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    envVars[key] = value;
  }
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  webServer: [
    {
      command: "cd ../api && python -m uvicorn main:app --host 0.0.0.0 --port 8000",
      port: 8000,
      timeout: 15000,
      reuseExistingServer: true,
      env: {
        ...envVars,
        CONFIG_DIR: "../config",
        DATA_DIR: "../data",
      },
    },
    {
      command: "cd ../ui && bun run dev",
      port: 3000,
      timeout: 15000,
      reuseExistingServer: true,
      env: {
        API_URL: "http://localhost:8000",
      },
    },
  ],
});
