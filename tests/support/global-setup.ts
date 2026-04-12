/**
 * Global setup: runs once before all E2E tests.
 * Ensures auth is disabled so tests can hit the API without credentials.
 */
import { request as playwrightRequest } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

export default async function globalSetup() {
  const ctx = await playwrightRequest.newContext({ baseURL: "http://localhost:3000" });
  try {
    const resp = await ctx.delete("/api/auth/key");
    if (resp.status() === 401) {
      // Auth is already enabled — read the key from workspace and retry
      const keyPath = resolve(__dirname, "../../workspace/api_key");
      try {
        const key = readFileSync(keyPath, "utf-8").trim();
        await ctx.delete("/api/auth/key", { headers: { "X-API-Key": key } });
      } catch {
        // Key file not readable or delete still failed — continue anyway
      }
    }
  } catch {
    // No key to delete — that's fine.
  } finally {
    await ctx.dispose();
  }
}
