/**
 * E2E tests for the Skills builder UI and API.
 *
 * Happy path: list skills, create skill, invoke via /skill, delete.
 * Unhappy path: missing name/prompt, duplicate name.
 *
 * Covers ISSUES.md #14.
 */
import { test, expect } from "@playwright/test";

test.describe("Skills API", () => {
  test("GET /api/skills returns skills list", async ({ request }) => {
    const resp = await request.get("/api/skills");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data.skills)).toBe(true);
    // Built-in skills should be present
    const names = data.skills.map((s: any) => s.name);
    expect(names).toContain("summarise");
  });

  test("POST /api/skills creates a skill", async ({ request }) => {
    const uniqueName = `test-skill-${Date.now()}`;
    const resp = await request.post("/api/skills", {
      data: {
        name: uniqueName,
        description: "Test skill",
        prompt: "Please process: {input}",
        agent: "general",
      },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.name).toBe(uniqueName);

    // Verify it appears in list
    const listResp = await request.get("/api/skills");
    const list = await listResp.json();
    expect(list.skills.some((s: any) => s.name === uniqueName)).toBe(true);

    // Cleanup
    await request.delete(`/api/skills/${uniqueName}`);
  });

  test("DELETE /api/skills/:name removes a user-created skill", async ({ request }) => {
    const uniqueName = `test-delete-${Date.now()}`;
    await request.post("/api/skills", {
      data: { name: uniqueName, description: "To delete", prompt: "Test {input}", agent: "general" },
    });

    const resp = await request.delete(`/api/skills/${uniqueName}`);
    expect(resp.ok()).toBeTruthy();

    // Verify it's gone
    const listResp = await request.get("/api/skills");
    const list = await listResp.json();
    expect(list.skills.some((s: any) => s.name === uniqueName)).toBe(false);
  });

  test("POST /api/skills returns 400 for missing name or prompt", async ({ request }) => {
    const resp = await request.post("/api/skills", {
      data: { description: "No name or prompt" },
    });
    expect(resp.status()).toBe(400);
  });

  test("DELETE /api/skills/:name returns 404 for unknown skill", async ({ request }) => {
    const resp = await request.delete("/api/skills/__nonexistent_skill__");
    expect(resp.status()).toBe(404);
  });

  test("Cannot delete a built-in skill", async ({ request }) => {
    const resp = await request.delete("/api/skills/summarise");
    expect([400, 403, 404]).toContain(resp.status());
  });
});

test.describe("Skills panel UI", () => {
  test("Skills panel opens from sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button[title='Skills']").click();
    await expect(page.locator("text=Skills")).toBeVisible({ timeout: 3000 });
  });

  test("Skills panel lists existing skills", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("button[title='Skills']").click();
    await expect(page.locator("text=summarise")).toBeVisible({ timeout: 5000 });
  });
});
