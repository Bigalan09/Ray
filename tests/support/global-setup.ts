/**
 * Global setup: runs once before all E2E tests.
 * Ensures auth is disabled so tests can hit the API without credentials.
 */
import { request as playwrightRequest } from "@playwright/test";

export default async function globalSetup() {
  const ctx = await playwrightRequest.newContext({ baseURL: "http://localhost:3000" });
  try {
    await ctx.delete("/api/auth/key");
  } catch {
    // No key to delete — that's fine.
  } finally {
    await ctx.dispose();
  }
}
