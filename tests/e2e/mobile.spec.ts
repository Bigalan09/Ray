/**
 * Mobile UI regression tests — covers issues #34–#41 from ISSUES.md.
 * Tests run against the deployed stack with a 375×812 viewport (iPhone SE).
 */
import { test, expect } from "@playwright/test";

const MOBILE = { width: 375, height: 812 };
const NARROW = { width: 360, height: 640 };

// ─── Issue #39: Viewport meta tag ─────────────────────────────────────────────

test.describe("Mobile #39 — viewport meta tag", () => {
  test("viewport meta has width=device-width and initial-scale=1", async ({ page }) => {
    await page.goto("/");
    const content = await page.$eval(
      'meta[name="viewport"]',
      (el) => el.getAttribute("content"),
    );
    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1");
  });

  test("viewport meta does not prevent user zoom (no user-scalable=no)", async ({ page }) => {
    await page.goto("/");
    const content = await page.$eval(
      'meta[name="viewport"]',
      (el) => el.getAttribute("content"),
    );
    expect(content).not.toContain("user-scalable=no");
    expect(content).not.toContain("maximum-scale=1");
  });
});

// ─── Issue #40: Code block overflow ───────────────────────────────────────────

test.describe("Mobile #40 — code block overflow", () => {
  test("page does not scroll horizontally with a long code block", async ({ page, request }) => {
    // Load the conversation at desktop width so the sidebar is visible
    const conv = await (
      await request.post("/api/conversations", { data: { title: "Code Overflow Test Mobile" } })
    ).json();
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: { role: "user", content: "show me code" },
    });
    await request.post(`/api/conversations/${conv.id}/messages`, {
      data: {
        role: "assistant",
        content:
          "```javascript\nconst veryLongVariableName = someFunction(argument1, argument2, argument3, argument4, argument5, argument6);\n```",
      },
    });

    await page.goto("/");
    await page.click(`text=Code Overflow Test Mobile`);
    await expect(page.locator(".message-content").first()).toBeVisible({ timeout: 5000 });

    // Now shrink to mobile to test overflow
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(200);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});

// ─── Issue #38: StatusBar wrapping ────────────────────────────────────────────

test.describe("Mobile #38 — StatusBar does not overflow on narrow screens", () => {
  test("status bar fits within viewport width at 360px", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto("/");
    // The StatusBar always renders — find it by its border-t class shared with the input form
    // It's the div directly above the SystemPromptPanel button area
    const bar = page.locator("div.border-t.bg-\\[var\\(--bg-input\\)\\]");
    await expect(bar).toBeVisible({ timeout: 5000 });
    const box = await bar.boundingBox();
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(NARROW.width + 1);
    }
  });
});

// ─── Issue #37: Dynamic viewport height ───────────────────────────────────────

test.describe("Mobile #37 — root container uses dvh", () => {
  test("root container class contains h-[100dvh]", async ({ page }) => {
    await page.goto("/");
    const rootCls = await page.locator("div.font-sans").first().getAttribute("class");
    // Class attribute contains literal brackets: "h-[100dvh]"
    expect(rootCls).toContain("h-[100dvh]");
  });
});

// ─── Issue #36: SlidePanel width constraint ───────────────────────────────────

test.describe("Mobile #36 — slide panel does not overflow viewport", () => {
  test("Tasks panel does not exceed viewport width at 375px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // On mobile the sidebar is hidden — open it first
    await page.click("button[title='Show sidebar']");
    await expect(page.locator("text=Tasks")).toBeVisible({ timeout: 2000 });
    await page.locator("text=Tasks").first().click();
    // Close the sidebar backdrop before the panel opens
    await expect(page.locator("text=Background Tasks")).toBeVisible({ timeout: 5000 });
    const panel = page.locator("div.fixed").filter({ hasText: "Background Tasks" }).first();
    const box = await panel.boundingBox();
    if (box) {
      expect(box.width).toBeLessThanOrEqual(MOBILE.width + 1);
      expect(box.x).toBeGreaterThanOrEqual(-1);
    }
  });
});

// ─── Issue #35: Touch target minimum size ─────────────────────────────────────

test.describe("Mobile #35 — touch targets are at least 44px", () => {
  test("header hamburger button is at least 44×44px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    const btn = page.locator("button[title='Hide sidebar'], button[title='Show sidebar']").first();
    const box = await btn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  test("SlidePanel close button is at least 44×44px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Open sidebar, then Tasks panel
    await page.click("button[title='Show sidebar']");
    await page.locator("text=Tasks").first().click();
    await expect(page.locator("text=Background Tasks")).toBeVisible({ timeout: 5000 });
    const close = page.locator("button[title='Close']").first();
    const box = await close.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });
});

// ─── Issue #34: Sidebar overlay drawer on mobile ──────────────────────────────

test.describe("Mobile #34 — sidebar is hidden by default on small screens", () => {
  test("sidebar starts hidden at 375px viewport", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // On mobile the sidebar text labels should not be visible by default
    const newSession = page.locator("text=New session");
    await expect(newSession).not.toBeVisible();
  });

  test("sidebar can be opened via hamburger and shows backdrop", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("button[title='Show sidebar']");
    await expect(page.locator("text=New session")).toBeVisible({ timeout: 2000 });
    // Backdrop overlay should be present
    await expect(page.locator("[data-testid='sidebar-backdrop']")).toBeVisible();
  });

  test("clicking backdrop closes sidebar", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.click("button[title='Show sidebar']");
    await expect(page.locator("text=New session")).toBeVisible({ timeout: 2000 });
    // Click the backdrop at the right edge of the screen (outside the 256px sidebar)
    await page.click("[data-testid='sidebar-backdrop']", { position: { x: 340, y: 400 } });
    await expect(page.locator("text=New session")).not.toBeVisible({ timeout: 2000 });
  });
});

// ─── Issue #41: Attachment strip overflow ─────────────────────────────────────

test.describe("Mobile #41 — attachment strip wraps on mobile", () => {
  test("attachment strip shows +N badge when more than 2 images attached", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");

    // Use the hidden file input to attach 3 images
    const imageInput = page.locator('input[type="file"][accept="image/*"]');
    const files = [
      { name: "a.png", mimeType: "image/png", buffer: Buffer.from("fakeimg1") },
      { name: "b.png", mimeType: "image/png", buffer: Buffer.from("fakeimg2") },
      { name: "c.png", mimeType: "image/png", buffer: Buffer.from("fakeimg3") },
    ];
    await imageInput.setInputFiles(files);

    // Should show +1 overflow badge (2 visible + 1 extra)
    await expect(page.locator("text=+1")).toBeVisible({ timeout: 3000 });
  });
});
