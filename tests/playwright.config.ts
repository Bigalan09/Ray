import { defineConfig } from "@playwright/test";
import { resolve } from "path";
import { loadPreferredEnv } from "./support/env";
import { resolvePythonBin } from "./support/python";

const envVars = loadPreferredEnv(
  resolve(__dirname, ".env"),
  resolve(__dirname, "../.env"),
);
const pythonBin = resolvePythonBin();
const pythonCommand = JSON.stringify(pythonBin);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./support/global-setup.ts",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  webServer: [
    {
      command: `cd ../api && ${pythonCommand} -m uvicorn main:app --host 0.0.0.0 --port 8000`,
      port: 8000,
      timeout: 15000,
      reuseExistingServer: true,
      env: {
        ...envVars,
        CONFIG_DIR: "../config",
        DATA_DIR: "../workspace",
        WORKSPACE_DIR: "../workspace",
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
