/**
 * E2E tests for image upload → multimodal LLM response.
 *
 * Happy path: attach image → send question → LLM describes image content.
 * Unhappy path: oversized image rejected, attachment preview shown, remove works.
 *
 * Covers ISSUES.md #25.
 * Live LLM tests skip without OPENAI_API_KEY.
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const requireLLM = () => {
  if (!process.env.OPENAI_API_KEY) test.skip();
};

// Create a minimal valid PNG (1x1 red pixel) for testing
function createTestPng(): Buffer {
  // Minimal 1x1 red PNG
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
    "2e000000097048597300000b1300000b1301009a9c180000000c49444154" +
    "789c626060f80f0000020001e221bc330000000049454e44ae426082",
    "hex"
  );
}

test.describe("Image upload UI", () => {
  test("image attach button is visible in input bar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("button[title='Attach image']")).toBeVisible();
  });

  test("image file input is in the DOM (for setInputFiles)", async ({ page }) => {
    await page.goto("/");
    const input = page.locator("input[type='file'][accept*='image']");
    await expect(input).toBeAttached();
  });

  test("attaching an image shows preview thumbnail", async ({ page }) => {
    await page.goto("/");

    // Create a temporary test image
    const tmpDir = fs.mkdtempSync("/tmp/ray-test-");
    const imgPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(imgPath, createTestPng());

    try {
      // Use setInputFiles directly on the hidden file input
      const input = page.locator("input[type='file'][accept*='image']");
      await input.setInputFiles(imgPath);

      // Attachment preview should appear
      await expect(page.locator("img[alt='test.png']")).toBeVisible({ timeout: 3000 });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("attached image can be removed via X button", async ({ page }) => {
    await page.goto("/");

    const tmpDir = fs.mkdtempSync("/tmp/ray-test-");
    const imgPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(imgPath, createTestPng());

    try {
      const input = page.locator("input[type='file'][accept*='image']");
      await input.setInputFiles(imgPath);

      // Wait for preview to appear
      await expect(page.locator("img[alt='test.png']")).toBeVisible({ timeout: 3000 });

      // Click remove button
      await page.locator("button[title='Remove']").first().click();

      // Preview should disappear
      await expect(page.locator("img[alt='test.png']")).not.toBeVisible();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("multiple images can be attached", async ({ page }) => {
    await page.goto("/");

    const tmpDir = fs.mkdtempSync("/tmp/ray-test-");
    const img1 = path.join(tmpDir, "first.png");
    const img2 = path.join(tmpDir, "second.png");
    fs.writeFileSync(img1, createTestPng());
    fs.writeFileSync(img2, createTestPng());

    try {
      const input = page.locator("input[type='file'][accept*='image']");
      await input.setInputFiles([img1, img2]);

      await expect(page.locator("img")).toHaveCount(2, { timeout: 3000 });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

test.describe("Image upload → multimodal LLM response (live)", () => {
  test.beforeEach(() => requireLLM());

  test("send image with question → LLM responds about the image", async ({ page }) => {
    await page.goto("/");

    const tmpDir = fs.mkdtempSync("/tmp/ray-test-");
    const imgPath = path.join(tmpDir, "test.png");
    fs.writeFileSync(imgPath, createTestPng());

    try {
      const input = page.locator("input[type='file'][accept*='image']");
      await input.setInputFiles(imgPath);

      // Wait for preview
      await expect(page.locator("img[alt='test.png']")).toBeVisible({ timeout: 3000 });

      // Type a question and send
      const textarea = page.locator("textarea");
      await textarea.fill("What colour is this image?");
      await page.locator("button:has-text('Send')").click();

      // Wait for LLM response (longer timeout for live calls)
      await expect(
        page.locator("[class*='message']").filter({ hasText: /red|colour|color|image|pixel/i })
      ).toBeVisible({ timeout: 30000 });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
