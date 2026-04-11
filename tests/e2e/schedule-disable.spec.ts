/**
 * E2E tests for schedule enable/disable lifecycle.
 *
 * Happy path: create → disable → verify disabled → re-enable → verify enabled.
 * Unhappy path: PATCH unknown schedule returns 404; PATCH with invalid body returns 400.
 *
 * Covers ISSUES.md #26.
 */
import { test, expect } from "@playwright/test";

const TEST_SCHEDULE = {
  name: `test-disable-${Date.now()}`,
  cron: "0 3 * * *",
  prompt: "test schedule disable prompt",
  agent: "general",
};

test.describe("Schedule enable/disable", () => {
  test.afterEach(async ({ request }) => {
    // Clean up test schedule
    await request.delete(`/api/schedules/${TEST_SCHEDULE.name}`).catch(() => {});
  });

  test("POST /api/schedules creates enabled schedule", async ({ request }) => {
    const resp = await request.post("/api/schedules", { data: TEST_SCHEDULE });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.name).toBe(TEST_SCHEDULE.name);
  });

  test("GET /api/schedules returns schedule with enabled flag", async ({ request }) => {
    await request.post("/api/schedules", { data: TEST_SCHEDULE });

    const resp = await request.get("/api/schedules");
    expect(resp.ok()).toBeTruthy();
    const schedules = await resp.json();
    const schedule = schedules.find((s: any) => s.name === TEST_SCHEDULE.name);
    expect(schedule).toBeTruthy();
    expect(schedule.enabled).toBe(true);
  });

  test("PATCH /api/schedules/:name disables a schedule", async ({ request }) => {
    await request.post("/api/schedules", { data: TEST_SCHEDULE });

    const resp = await request.patch(`/api/schedules/${TEST_SCHEDULE.name}`, {
      data: { enabled: false },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.enabled).toBe(false);
  });

  test("disabled schedule shows enabled: false in list", async ({ request }) => {
    await request.post("/api/schedules", { data: TEST_SCHEDULE });
    await request.patch(`/api/schedules/${TEST_SCHEDULE.name}`, { data: { enabled: false } });

    const resp = await request.get("/api/schedules");
    const schedules = await resp.json();
    const schedule = schedules.find((s: any) => s.name === TEST_SCHEDULE.name);
    expect(schedule).toBeTruthy();
    expect(schedule.enabled).toBe(false);
    // Disabled schedule has no next_run
    expect(schedule.next_run).toBeNull();
  });

  test("PATCH re-enables a disabled schedule", async ({ request }) => {
    await request.post("/api/schedules", { data: TEST_SCHEDULE });
    await request.patch(`/api/schedules/${TEST_SCHEDULE.name}`, { data: { enabled: false } });

    const resp = await request.patch(`/api/schedules/${TEST_SCHEDULE.name}`, {
      data: { enabled: true },
    });
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.enabled).toBe(true);
  });

  test("PATCH unknown schedule returns 404", async ({ request }) => {
    const resp = await request.patch("/api/schedules/nonexistent-xyz", {
      data: { enabled: false },
    });
    expect(resp.status()).toBe(404);
  });

  test("PATCH with no enabled field returns 400", async ({ request }) => {
    await request.post("/api/schedules", { data: TEST_SCHEDULE });
    const resp = await request.patch(`/api/schedules/${TEST_SCHEDULE.name}`, {
      data: { cron: "* * * * *" },
    });
    expect(resp.status()).toBe(400);
  });
});
