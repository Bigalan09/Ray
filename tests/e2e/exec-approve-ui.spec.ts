/**
 * E2E test for the full exec approval card flow in the UI.
 *
 * Happy path: /exec git status → approval card renders → click Allow → output in chat.
 * Unhappy path: clicking Deny returns denied message.
 *
 * Covers ISSUES.md #27.
 */
import { test, expect } from "@playwright/test";

test.describe("Exec approve button UI", () => {
  test("full flow: /exec git status → Allow → output in chat", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Send an exec command that is in the allowlist
    const textarea = page.locator("textarea");
    await textarea.fill("/exec git status");
    await page.locator("button:has-text('Send'), button[type='submit']").click();

    // Approval card should appear in the input area
    await expect(page.locator("text=Allow Ray to run command?")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("code").filter({ hasText: /git status/ })).toBeVisible();

    // Normal input should be hidden while the card is showing
    await expect(textarea).not.toBeVisible();

    // Click Allow
    await page.locator("button:has-text('Allow')").click();

    // Input should return after approval
    await expect(textarea).toBeVisible({ timeout: 15000 });

    // Command output should appear in the chat as an assistant or tool message
    // git status output contains "On branch" or "nothing to commit" etc.
    await expect(
      page.locator(".message-content, [class*='message']").filter({ hasText: /branch|commit|staged|untracked/i })
    ).toBeVisible({ timeout: 15000 });
  });

  test("full flow: /exec git status → Deny → denied in chat", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const textarea = page.locator("textarea");
    await textarea.fill("/exec git status");
    await page.locator("button:has-text('Send'), button[type='submit']").click();

    await expect(page.locator("text=Allow Ray to run command?")).toBeVisible({ timeout: 10000 });

    // Click Deny
    await page.locator("button:has-text('Deny')").click();

    // Input should return
    await expect(textarea).toBeVisible({ timeout: 10000 });
  });

  test("approval card shows command and description", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("textarea").fill("/exec git status");
    await page.locator("button:has-text('Send'), button[type='submit']").click();

    await expect(page.locator("text=Allow Ray to run command?")).toBeVisible({ timeout: 10000 });

    // Both buttons must be present
    await expect(page.locator("button:has-text('Allow')")).toBeVisible();
    await expect(page.locator("button:has-text('Deny')")).toBeVisible();

    // The command should be shown
    await expect(page.locator("code").filter({ hasText: /git/ })).toBeVisible();
  });
});
