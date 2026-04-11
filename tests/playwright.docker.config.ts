/**
 * Playwright config for running E2E tests against the live Docker stack.
 *
 * Prerequisites:
 *   docker compose up -d   (from ~/deployments or the repo root)
 *   Stack must be reachable at http://localhost:3000 / http://localhost:8000
 *
 * Usage:
 *   cd tests && npx playwright test --config=playwright.docker.config.ts
 *   cd tests && npx playwright test --config=playwright.docker.config.ts e2e/full-coverage.spec.ts
 *
 * Env vars:
 *   RAY_BASE_URL  — override base URL (default: http://localhost:3000)
 *   RAY_API_URL   — override API URL  (default: http://localhost:8000)
 *   OPENAI_API_KEY — set to run live-LLM tests (otherwise they are skipped)
 */
import { defineConfig } from "@playwright/test";

const BASE_URL = process.env.RAY_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,        // Docker LLM calls can be slow
  retries: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    // Longer navigation timeouts for cold-start LLM responses
    navigationTimeout: 15_000,
    actionTimeout: 15_000,
  },
  // No webServer block — expects the stack to already be running
});
