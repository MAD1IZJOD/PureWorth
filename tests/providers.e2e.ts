import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { ComparisonResponse } from "../lib/domain";

test.beforeEach(async ({ page }) => { await page.goto("/"); });
async function review(page: Page) {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Good matches. No surprises." })).toBeVisible();
}
async function optimize(page: Page): Promise<ComparisonResponse> {
  const response = page.waitForResponse(r => r.url().endsWith("/api/compare") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Find my best basket", exact: true }).click();
  const data = await (await response).json();
  await expect(page.getByRole("heading", { name: "Your list. A smarter total." })).toBeVisible();
  return data;
}
async function simulation(page: Page, value: string) {
  await page.getByText("Explore simulated provider states", { exact: true }).click();
  await page.getByLabel("Simulation scenario").selectOption(value);
}

test("demo coverage and all unavailable real providers remain explicit and accessible", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  page.on("console", entry => { if (["warning", "error"].includes(entry.type())) errors.push(entry.text()); });
  await page.getByText("Provider availability · real connections are not enabled", { exact: true }).click();
  const availability = page.locator(".provider-availability");
  for (const name of ["Blinkit", "Zepto", "Swiggy Instamart", "BigBasket", "Amazon India", "Flipkart", "ONDC network"]) await expect(availability.getByRole("listitem").filter({ hasText: name })).toContainText("Not connected");
  await page.getByText("Explore simulated provider states", { exact: true }).click();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("region", { name: "Price data and coverage" }).screenshot({ path: info.outputPath("provider-status.png") });
  expect(errors).toEqual([]);
});

test("PIN validation never assigns a nearby area and changes invalidate results", async ({ page }) => {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.getByLabel("Delivery PIN").fill("012345");
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("six-digit Indian PIN");
  await page.getByLabel("Delivery PIN").fill("999999");
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  const unavailable = await optimize(page);
  expect(unavailable.result.cheapest).toBeNull(); expect(unavailable.result.savings).toBeNull();
  await expect(page.getByTestId("basket-total")).toHaveCount(0);
  await page.getByLabel("Demo service area").selectOption("pune");
  await page.getByLabel("Delivery PIN").fill("411001");
  await expect(page.getByTestId("freshness-status")).toHaveText("No comparison yet");
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  const data = await optimize(page);
  expect(data.pricing!.comparisonComplete).toBe(true);
  expect(data.matches.flatMap(m => m.matches).some(m => m.product.id === "daily-eggs")).toBe(false);
});

for (const state of ["stale", "expired"]) test(`${state} fixture prices are withheld until refreshed`, async ({ page }) => {
  await simulation(page, state); await review(page); const data = await optimize(page);
  expect(data.result.cheapest).toBeNull(); expect(data.result.reference).toBeNull();
  await expect(page.getByTestId("freshness-status")).toHaveText(state.toUpperCase());
  await expect(page.getByTestId("basket-total")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh prices", exact: true }).click();
  await expect(page.getByTestId("freshness-status")).toHaveText("FRESH");
  await expect(page.getByTestId("basket-total")).toHaveText("₹1,039");
});

for (const state of ["timeout", "partial", "missing-fees"]) test(`${state} provider responses cannot create false savings and recover on refresh`, async ({ page }) => {
  await simulation(page, state); await review(page); const data = await optimize(page);
  expect(data.pricing!.comparisonComplete).toBe(false); expect(data.result.savings).toBeNull(); expect(data.result.reference).toBeNull();
  await expect(page.locator(".savings-note")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Price data and coverage" })).toContainText("No savings are claimed");
  if (state === "missing-fees") { expect(data.result.cheapest).toBeNull(); await expect(page.getByTestId("basket-total")).toHaveCount(0); }
  else expect(data.result.cheapest).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Refresh prices", exact: true }).click();
  await expect(page.getByTestId("basket-total")).toHaveText("₹1,039");
  await expect(page.locator(".savings-note")).toContainText("Estimated comparison");
});

test("a current estimate becomes stale, closes its preview and requires recalculation", async ({ page }) => {
  await page.clock.install(); await review(page); await optimize(page);
  await page.getByRole("button", { name: "Checkout preview", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.clock.fastForward(121_000);
  await expect(page.getByTestId("freshness-status")).toHaveText("STALE");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Checkout preview", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save shopping plan", exact: true })).toBeDisabled();
  await expect(page.locator(".savings-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh basket estimate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Checkout preview", exact: true })).toBeEnabled();
  await expect(page.getByTestId("freshness-status")).toHaveText("FRESH");
});

test("quote expiry remains explicit even with a skewed device clock", async ({ page }) => {
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await review(page); await optimize(page);
  await expect(page.getByTestId("freshness-status")).toHaveText("FRESH");
  await page.clock.fastForward(301_000);
  await expect(page.getByTestId("freshness-status")).toHaveText("EXPIRED");
  await expect(page.getByRole("button", { name: "Checkout preview", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh prices", exact: true }).click();
  await expect(page.getByTestId("freshness-status")).toHaveText("FRESH");
  await expect(page.getByRole("button", { name: "Checkout preview", exact: true })).toBeEnabled();
});

test("quantity changes generate different complete-basket quote fingerprints", async ({ page }) => {
  await review(page); const first = await optimize(page);
  await page.getByRole("button", { name: "Increase Amul milk", exact: true }).click();
  await expect(page.getByTestId("basket-total")).toHaveCount(0);
  await expect(page.getByTestId("freshness-status")).toHaveText("No comparison yet");
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  const second = await optimize(page);
  expect(second.result.cheapest!.total).not.toBe(first.result.cheapest!.total);
  expect(second.pricing!.quotes.map(q => q.fingerprint)).not.toEqual(first.pricing!.quotes.map(q => q.fingerprint));
});

test("a rate-limit response preserves the list and retry recovers", async ({ page }) => {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.route("**/api/compare", async route => { await route.fulfill({ status: 429, contentType: "application/json", headers: { "Retry-After": "1" }, body: JSON.stringify({ error: "Comparison is busy. Retry shortly." }) }); }, { times: 1 });
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Retry shortly");
  await expect(page.getByTestId("shopping-item")).toHaveCount(5);
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  expect((await optimize(page)).pricing!.comparisonComplete).toBe(true);
});
