import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function basket(page: Page) {
  await page.goto("/"); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await page.getByRole("button", { name: "Find my best basket", exact: true }).click();
  await expect(page.getByTestId("basket-total")).toBeVisible();
}

test("beta feedback and privacy have accessible honest unavailable states", async ({ page }, info) => {
  await page.goto("/");
  await page.getByText("Share feedback about the demo", { exact: true }).click();
  await page.getByText("Privacy and optional usage sharing", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Feedback unavailable" })).toBeDisabled();
  await expect(page.getByLabel("Your feedback (optional)")).toBeDisabled();
  await expect(page.getByLabel("Share optional usage events for this page")).toBeDisabled();
  await expect(page.locator("#beta-feedback")).toContainText("Nothing you type here will be submitted");
  expect((await new AxeBuilder({ page }).include("#beta-feedback").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#beta-feedback").screenshot({ path: info.outputPath("beta-panel.png") });
});
test("usage sharing stays silent by default throughout the shopping journey", async ({ page }) => {
  const analytics: string[] = []; page.on("request", request => { if (request.url().endsWith("/api/analytics")) analytics.push(request.postData() ?? ""); });
  await basket(page); await page.getByRole("button", { name: /One-store shop/ }).click();
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Save shopping plan" }).click(); await downloaded;
  expect(analytics).toEqual([]);
});
test("failed shopping plan downloads show a recoverable error", async ({ page }) => {
  await basket(page);
  await page.evaluate(() => { const original = URL.createObjectURL; Object.assign(window, { restoreDownload: () => { URL.createObjectURL = original; } }); URL.createObjectURL = () => { throw new Error("injected download failure"); }; });
  await page.getByRole("button", { name: "Save shopping plan" }).click();
  await expect(page.getByRole("alert")).toContainText("Your browser could not save the plan");
  await expect(page.getByTestId("basket-total")).toContainText("1,039");
  await page.evaluate(() => (window as typeof window & { restoreDownload: () => void }).restoreDownload());
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Save shopping plan" }).click();
  expect((await downloaded).suggestedFilename()).toBe("pureworth-demo-shopping-plan.txt");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("reload clears page-memory lists and old quotes with no purchase claim", async ({ page }) => {
  await basket(page); await page.reload();
  await expect(page.getByTestId("shopping-item")).toHaveCount(0); await expect(page.getByTestId("basket-total")).toHaveCount(0);
  await expect(page.locator(".demo-strip")).toContainText("No live retailer prices, payments or orders");
});
test("health and readiness disclose no secrets and browser policies are active", async ({ page, request }) => {
  const response = await page.goto("/"); const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["x-robots-tag"]).toContain("noindex");
  const health = await request.get("/api/health"); expect(await health.json()).toEqual({ status: "alive" });
  const ready = await request.get("/api/ready"); expect(ready.status()).toBe(200); expect(await ready.json()).toMatchObject({ mode: "demonstration", providers: "simulated" });
  expect(await ready.text()).not.toMatch(/token|password|redis|upstash/i);
});
test("render failures recover through the safe beta error screen", async ({ page }) => {
  let comparisons = 0;
  await page.route("**/api/compare", async route => {
    const response = await route.fetch(); const data = await response.json(); comparisons++;
    if (comparisons === 2) data.result.cheapest.orders = null;
    await route.fulfill({ response, json: data });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await page.getByRole("button", { name: "Find my best basket", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Let’s get you back to your list." })).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("No payment or order has occurred");
  await expect(page.getByRole("alert")).not.toContainText("TypeError");
  await page.getByRole("button", { name: "Start a fresh shopping list" }).click();
  await expect(page.getByRole("heading", { name: "Good groceries. Better math." })).toBeVisible();
  await expect(page.getByTestId("shopping-item")).toHaveCount(0);
});
