/**
 * E2E tests for pre/post command hook rules API and UI.
 *
 * Covers ISSUES.md #33: Pre/post command hook rules have no UI and no test coverage.
 *
 * Happy path: list rules, create pre rule, create post rule, toggle, delete.
 * Unhappy path: delete unknown rule returns 404, PATCH without enabled returns 400.
 * UI: hooks panel opens, Rules tab visible, add-rule form renders.
 */
import { test, expect } from "@playwright/test";

test.describe("Hook Rules API", () => {
  let createdRuleId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (createdRuleId) {
      await request.delete(`/api/hooks/rules/${createdRuleId}`).catch(() => {});
      createdRuleId = null;
    }
  });

  test("GET /api/hooks/rules returns array", async ({ request }) => {
    const resp = await request.get("/api/hooks/rules");
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test("POST /api/hooks/rules creates a post rule", async ({ request }) => {
    const resp = await request.post("/api/hooks/rules", {
      data: {
        name: "e2e-post-rule",
        type: "post",
        trigger: "tool:*",
        handler: "log",
        enabled: true,
      },
    });
    expect(resp.status()).toBe(201);
    const rule = await resp.json();
    expect(rule.type).toBe("post");
    expect(rule.trigger).toBe("tool:*");
    expect(rule.id).toBeTruthy();
    createdRuleId = rule.id;

    // Verify appears in list
    const listResp = await request.get("/api/hooks/rules");
    const rules = await listResp.json() as any[];
    expect(rules.some((r) => r.id === createdRuleId)).toBe(true);
  });

  test("POST /api/hooks/rules creates a pre rule", async ({ request }) => {
    const resp = await request.post("/api/hooks/rules", {
      data: {
        name: "e2e-pre-rule",
        type: "pre",
        trigger: "command:exec",
        handler: "log",
        enabled: true,
      },
    });
    expect(resp.status()).toBe(201);
    const rule = await resp.json();
    expect(rule.type).toBe("pre");
    createdRuleId = rule.id;
  });

  test("PATCH /api/hooks/rules/:id disables a rule", async ({ request }) => {
    // Create first
    const createResp = await request.post("/api/hooks/rules", {
      data: { name: "toggle-test", type: "post", trigger: "*", handler: "log" },
    });
    expect(createResp.status()).toBe(201);
    const rule = await createResp.json();
    createdRuleId = rule.id;

    // Disable
    const patchResp = await request.patch(`/api/hooks/rules/${createdRuleId}`, {
      data: { enabled: false },
    });
    expect(patchResp.ok()).toBeTruthy();
    expect((await patchResp.json()).success).toBeTruthy();

    // Verify disabled
    const listResp = await request.get("/api/hooks/rules");
    const rules = await listResp.json() as any[];
    const found = rules.find((r) => r.id === createdRuleId);
    expect(found?.enabled).toBe(false);
  });

  test("PATCH without enabled field returns 400", async ({ request }) => {
    const createResp = await request.post("/api/hooks/rules", {
      data: { name: "bad-patch", type: "post", trigger: "*", handler: "log" },
    });
    const rule = await createResp.json();
    createdRuleId = rule.id;

    const resp = await request.patch(`/api/hooks/rules/${createdRuleId}`, {
      data: { trigger: "tool:*" },
    });
    expect(resp.status()).toBe(400);
  });

  test("DELETE /api/hooks/rules/:id removes a rule", async ({ request }) => {
    const createResp = await request.post("/api/hooks/rules", {
      data: { name: "del-test", type: "post", trigger: "*", handler: "log" },
    });
    const rule = await createResp.json();
    const id = rule.id;

    const resp = await request.delete(`/api/hooks/rules/${id}`);
    expect(resp.ok()).toBeTruthy();

    // Verify gone
    const listResp = await request.get("/api/hooks/rules");
    const rules = await listResp.json() as any[];
    expect(rules.some((r: any) => r.id === id)).toBe(false);
    createdRuleId = null;
  });

  test("DELETE unknown rule returns 404", async ({ request }) => {
    const resp = await request.delete("/api/hooks/rules/nonexistent-rule-id");
    expect(resp.status()).toBe(404);
  });
});

test.describe("Hook Rules UI", () => {
  test("Webhooks panel has a Rules tab", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Webhooks" }).click();
    await expect(page.locator("button:has-text('Rules')").first()).toBeVisible({ timeout: 3000 });
  });

  test("Rules tab shows rule list and add-rule button", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Webhooks" }).click();
    await page.locator("button:has-text('Rules')").first().click();
    await expect(page.locator("button:has-text('+ New rule')").first()).toBeVisible({ timeout: 3000 });
  });

  test("Add-rule form renders on button click", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Webhooks" }).click();
    await page.locator("button:has-text('Rules')").first().click();
    await page.locator("button:has-text('+ New rule')").first().click();
    await expect(page.locator("select").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("button:has-text('Add Rule')").first()).toBeVisible({ timeout: 1000 });
  });
});
