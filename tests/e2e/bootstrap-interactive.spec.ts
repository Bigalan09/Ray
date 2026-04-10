/**
 * Interactive bootstrap test.
 *
 * Opens the UI in a visible browser, watches Ray's bootstrap greeting,
 * then uses an LLM to generate contextual replies and chat through the
 * full onboarding flow. Run with:
 *
 *   RAY_RUN_BOOTSTRAP_INTERACTIVE=1 cd tests && npx playwright test bootstrap-interactive --headed
 *
 * Reads OpenAI credentials from ../.env automatically.
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "path";
import { loadPreferredEnv } from "../support/env";
import { loadDefaultModel } from "../support/models";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_TURNS = 12;
const TURN_TIMEOUT = 45_000; // max wait for Ray to respond per turn
const SLOW_TYPE_DELAY = 30; // ms per character (so you can watch)

const ENV = loadPreferredEnv(
  resolve(__dirname, "../.env"),
  resolve(__dirname, "../../.env"),
);
const DEFAULT_MODEL = loadDefaultModel(resolve(__dirname, "../../config/models.yaml"));
const RUN_INTERACTIVE_BOOTSTRAP =
  ENV.RAY_RUN_BOOTSTRAP_INTERACTIVE === "1" ||
  process.env.RAY_RUN_BOOTSTRAP_INTERACTIVE === "1";

// ---------------------------------------------------------------------------
// LLM caller
// ---------------------------------------------------------------------------

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

const USER_SYSTEM_PROMPT = `You are a human being onboarded by an AI assistant called Ray.
You are having a natural conversation. Answer Ray's questions concisely.

About you:
- Name: Alan
- Role: Software engineer
- You like direct, terse communication
- You want Ray to be casual but professional, with dry wit
- Ray's emoji should be something techy (suggest a lightning bolt or robot)
- You care about privacy, no storing sensitive info
- You want help with planning, task breakdowns, and debugging

Rules:
- Reply in 1-3 sentences max
- Be natural, not robotic
- When Ray asks if you're happy with setup or ready to save, say yes
- When Ray tells you to type /bootstrap done, reply with EXACTLY: /bootstrap done`;

async function callLLM(messages: ChatMsg[]): Promise<string> {
  // Try OpenAI first
  const openaiBaseUrl = (ENV.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const openaiKey = ENV.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const model = DEFAULT_MODEL;

  if (openaiKey && !openaiKey.startsWith("your-")) {
    const url = `${openaiBaseUrl}/responses`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: USER_SYSTEM_PROMPT,
        input: messages.filter((m) => m.role !== "system"),
        max_output_tokens: 200,
        temperature: 0.7,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.output_text?.trim() || "Sure, sounds good.";
    }
    console.warn("OpenAI LLM call failed:", resp.status, await resp.text().catch(() => ""));
  }

  throw new Error(
    "No LLM configured. Set OPENAI_API_KEY in .env",
  );
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

interface UIMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

/** Read all visible messages from the chat UI. */
async function readMessages(page: Page): Promise<UIMessage[]> {
  await page.waitForTimeout(500);

  const msgs: UIMessage[] = [];
  // Select all message content elements directly
  const contentEls = page.locator(".message-content");
  const count = await contentEls.count();

  for (let i = 0; i < count; i++) {
    const el = contentEls.nth(i);
    const text = ((await el.textContent()) || "").trim();
    if (!text) continue;

    // Walk up to the message wrapper to determine role
    // User messages have a parent chain with "text-right"
    const wrapper = el.locator("xpath=ancestor::div[contains(@class, 'mb-4')]").first();
    const wrapperClass = (await wrapper.getAttribute("class").catch(() => "")) || "";

    let role: UIMessage["role"] = "assistant";
    if (wrapperClass.includes("text-right")) role = "user";
    else if (wrapperClass.includes("justify-center")) role = "system";

    msgs.push({ role, text });
  }

  return msgs;
}

/** Wait for Ray to finish responding (Stop button disappears, Send returns). */
async function waitForResponse(page: Page): Promise<void> {
  // First, wait for streaming to START (Stop button appears)
  try {
    await page.locator("button:has-text('Stop')").waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    // Might have already finished or never started (command result)
  }
  // Now wait for streaming to FINISH (Stop button gone, Send button back and enabled)
  await page.locator("button:has-text('Stop')").waitFor({ state: "hidden", timeout: TURN_TIMEOUT });
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("Interactive bootstrap", () => {
  test("LLM-driven bootstrap conversation", async ({ page }) => {
    test.skip(
      !RUN_INTERACTIVE_BOOTSTRAP,
      "Set RAY_RUN_BOOTSTRAP_INTERACTIVE=1 to run this live bootstrap test.",
    );
    test.setTimeout(5 * 60_000); // 5 minutes

    console.log("\n--- Starting interactive bootstrap test ---\n");

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait for Ray's first bootstrap message to appear in the DOM
    console.log("Waiting for Ray's opening message...");
    await page.locator(".message-content").first().waitFor({
      state: "visible",
      timeout: 60_000,
    });
    // Wait for streaming to finish
    await waitForResponse(page);

    let previousMessageCount = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // Read all messages
      const uiMessages = await readMessages(page);
      if (uiMessages.length === 0 || uiMessages.length === previousMessageCount) {
        // No new messages, wait a bit
        await page.waitForTimeout(2000);
        continue;
      }
      previousMessageCount = uiMessages.length;

      // Show the latest message
      const lastMsg = uiMessages[uiMessages.length - 1];
      const lastRole = lastMsg.role === "user" ? "You" : "Ray";
      console.log(`[${lastRole}] ${lastMsg.text.substring(0, 150)}${lastMsg.text.length > 150 ? "..." : ""}`);

      // If the last message is from the user, skip (waiting for Ray)
      if (lastMsg.role === "user") continue;

      // Check if bootstrap is done
      if (lastMsg.text.includes("Updated") && lastMsg.text.includes("how can I help")) {
        console.log("\nBootstrap complete.");
        break;
      }

      // Check if Ray said to type /bootstrap done
      const shouldBootstrapDone =
        lastMsg.text.toLowerCase().includes("/bootstrap done") && turn >= 4;

      // Build conversation for the LLM (swap roles: Ray is "assistant", we are "user")
      const llmMessages: ChatMsg[] = uiMessages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.text,
        }));

      let reply: string;
      if (shouldBootstrapDone) {
        reply = "/bootstrap done";
      } else {
        reply = await callLLM(llmMessages);
      }

      console.log(`[You] ${reply}`);

      // Type the reply
      const textarea = page.locator("textarea");
      await textarea.click();
      await textarea.fill("");
      await page.keyboard.type(reply, { delay: SLOW_TYPE_DELAY });

      // Send
      await page.click("button:has-text('Send')");

      // Wait for Ray's response
      await waitForResponse(page);
    }

    // ------------------------------------------------------------------
    // Validate bootstrap state
    // ------------------------------------------------------------------

    console.log("\n--- Validating bootstrap ---\n");

    const status = await (
      await page.request.get("/api/identity/bootstrap-status")
    ).json();
    expect(status.bootstrapped).toBe(true);
    console.log("Bootstrap status: complete");

    // Verify workspace files exist and have content
    const soul = await (await page.request.get("/api/identity/soul")).json();
    const user = await (await page.request.get("/api/identity/me")).json();
    const identity = await (
      await page.request.get("/api/identity/identity")
    ).json();

    expect(soul.content).toBeTruthy();
    expect(soul.content.length).toBeGreaterThan(20);
    console.log(`SOUL.md (${soul.content.length} chars): ${soul.content.substring(0, 80)}...`);

    expect(user.content).toBeTruthy();
    expect(user.content.length).toBeGreaterThan(20);
    expect(user.content.toLowerCase()).toContain("alan");
    console.log(`USER.md (${user.content.length} chars): ${user.content.substring(0, 80)}...`);

    expect(identity.content).toBeTruthy();
    expect(identity.content.length).toBeGreaterThan(10);
    expect(identity.content.toLowerCase()).toContain("ray");
    console.log(`IDENTITY.md (${identity.content.length} chars): ${identity.content.substring(0, 80)}...`);

    // ------------------------------------------------------------------
    // Post-bootstrap identity test: "Who are you, who am I?"
    // ------------------------------------------------------------------

    console.log("\n--- Identity test: same session ---\n");

    await askIdentityQuestion(page);
    await waitForResponse(page);

    const postBootstrapMessages = await readMessages(page);
    const identityResponse = postBootstrapMessages[postBootstrapMessages.length - 1];
    console.log(`[Ray] ${identityResponse.text.substring(0, 200)}${identityResponse.text.length > 200 ? "..." : ""}`);

    // Validate Ray knows who it is and who the user is
    const responseText = identityResponse.text.toLowerCase();
    expect(responseText).toContain("ray");
    expect(responseText).toContain("alan");
    console.log("PASS: Ray knows its name and the user's name");

    // ------------------------------------------------------------------
    // New session identity test: start fresh and ask again
    // ------------------------------------------------------------------

    console.log("\n--- Identity test: new session ---\n");

    // Click "New session" to clear conversation
    await page.click("text=New session");
    await expect(page.locator(".message-content")).toHaveCount(0, { timeout: 5000 });
    console.log("Session cleared.");

    // Ask the same question in the fresh session
    await askIdentityQuestion(page);
    await waitForResponse(page);

    const newSessionMessages = await readMessages(page);
    const newSessionResponse = newSessionMessages[newSessionMessages.length - 1];
    console.log(`[Ray] ${newSessionResponse.text.substring(0, 200)}${newSessionResponse.text.length > 200 ? "..." : ""}`);

    // Validate Ray still knows who it is and who the user is
    const newText = newSessionResponse.text.toLowerCase();
    expect(newText).toContain("ray");
    expect(newText).toContain("alan");
    console.log("PASS: After new session, Ray still knows its name and the user's name");

    // Keep browser open briefly
    await page.waitForTimeout(3000);
    console.log("\n--- All checks passed ---\n");
  });
});

/** Type "Who are you, who am I?" and send it. */
async function askIdentityQuestion(page: Page): Promise<void> {
  const question = "Who are you, who am I? Answer in two short sentences.";
  console.log(`[You] ${question}`);
  const textarea = page.locator("textarea");
  await textarea.click();
  await textarea.fill("");
  await page.keyboard.type(question, { delay: SLOW_TYPE_DELAY });
  await page.click("button:has-text('Send')");
}
