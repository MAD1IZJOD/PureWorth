import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ComparisonResponse } from "../lib/domain";
import { rupees } from "../lib/domain";

test.beforeEach(async ({ page }) => { await page.goto("/"); });

test("landing is keyboard accessible and fits the viewport", async ({ page }, info) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Good groceries.Better math.");
  await expect(page.getByRole("button", { name: "Compare my list", exact: true })).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to shopping list" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("heading", { level: 1 }).click();
  await page.screenshot({ path: info.outputPath("landing.png"), fullPage: true, animations: "disabled" });
});

test("example → matches → strategies → grouped cart → checkout and export", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await expect(page.getByTestId("shopping-item")).toHaveCount(5);
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Good matches. No surprises." })).toBeVisible();
  await expect(page.getByText("Exact match", { exact: true })).toHaveCount(15);
  const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/compare") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Find my best basket" }).click();
  const payload: ComparisonResponse = await (await responsePromise).json();
  await expect(page.getByTestId("basket-total")).toHaveText(rupees(payload.result.cheapest!.total));
  await expect(page.locator(".store-order")).toHaveCount(payload.result.cheapest!.orders.length);
  await page.getByRole("button", { name: /One-store shop/ }).click();
  await expect(page.getByTestId("basket-total")).toHaveText(rupees(payload.result.singleStore!.total));
  await expect(page.locator(".store-order")).toHaveCount(1);
  await page.getByRole("button", { name: /Fewer deliveries/ }).click();
  await expect(page.getByTestId("basket-total")).toHaveText(rupees(payload.result.fewerDeliveries!.total));
  await page.getByRole("button", { name: /Lowest total/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save shopping plan" }).click();
  const download = await downloadPromise;
  const content = await readFile((await download.path())!, "utf8");
  expect(content).toContain(`Total: ${rupees(payload.result.cheapest!.total)}`);
  expect(content).toContain("No order has been placed");
  await page.getByRole("button", { name: "Checkout preview", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ordering unavailable in demo" })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Checkout preview", exact: true }).click();
  await page.getByRole("button", { name: "Close checkout preview", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("heading", { name: "Your list. A smarter total." }).click();
  await page.locator("#comparison-results").screenshot({ path: info.outputPath("results.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});

test("natural language, quantity and brand editing, additions and removals work", async ({ page }) => {
  await page.getByLabel("What’s on your list?").fill("Amul milk 1L, rice 5kg, 12 eggs");
  await page.getByRole("button", { name: "Build my list" }).click();
  await expect(page.getByTestId("shopping-item")).toHaveCount(3);
  const milk = page.getByTestId("shopping-item").filter({ hasText: "Amul milk" });
  await milk.getByRole("button", { name: "Increase Amul milk", exact: true }).click();
  await expect(milk.locator(".stepper span")).toHaveText("2");
  await milk.getByText("Edit size & brand").click();
  await milk.getByLabel("Package quantity for Amul milk").fill("500");
  await milk.getByLabel("Brand for Amul milk").fill("Nandini");
  await expect(milk.getByLabel("Brand for Amul milk")).toHaveValue("Nandini");
  await page.getByLabel("Add a grocery item", { exact: true }).fill("sugar 1kg");
  await page.getByRole("button", { name: "Add grocery item", exact: true }).click();
  await expect(page.getByTestId("shopping-item")).toHaveCount(4);
  await page.getByRole("button", { name: "Remove rice", exact: true }).click();
  await expect(page.getByTestId("shopping-item")).toHaveCount(3);
});

test("package substitutions remain excluded until explicitly approved", async ({ page }) => {
  await page.getByLabel("What’s on your list?").fill("Amul milk 2L");
  await page.getByRole("button", { name: "Build my list" }).click();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByText("No exact match. Approve a suitable alternative, or edit this item.")).toBeVisible();
  await page.getByRole("button", { name: "Find my best basket" }).click();
  await expect(page.getByRole("heading", { name: "We can’t fulfill this complete list yet." })).toBeVisible();
  await page.getByRole("button", { name: "Review matches", exact: true }).click();
  await page.locator(".alternatives summary").click();
  const match = page.locator(".match-card").filter({ hasText: "Freshlane" }).filter({ hasText: "Amul Taaza toned milk" });
  await expect(match).toContainText("2 × 1 L");
  await match.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Find my best basket" }).click();
  await expect(page.getByTestId("basket-total")).toBeVisible();
  await expect(page.getByText("Approved package change", { exact: true })).toBeVisible();
});

test("unknown items and invalid natural language have honest error states", async ({ page }) => {
  await page.getByLabel("What’s on your list?").fill("milk -1L");
  await page.getByRole("button", { name: "Build my list" }).click();
  await expect(page.locator(".error-banner")).toContainText("positive quantities");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByLabel("What’s on your list?").fill("soap 2 packs");
  await page.getByRole("button", { name: "Build my list" }).click();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await page.getByRole("button", { name: "Find my best basket" }).click();
  await expect(page.getByText("No eligible match for: soap.")).toBeVisible();
  await expect(page.getByTestId("basket-total")).toHaveCount(0);
});

test("service area, store restrictions and retailer limit change the actual comparison", async ({ page }) => {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.getByLabel("Demo service area").selectOption("pune");
  await page.getByLabel("Maximum store orders").selectOption("1");
  await page.getByLabel("Extra budget for fewer deliveries").selectOption("0");
  await page.getByRole("checkbox", { name: /Pantry Club/ }).uncheck();
  const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/compare"));
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  const data: ComparisonResponse = await (await responsePromise).json();
  expect(data.matches.find(g => g.item.category === "eggs")!.matches.map(m => m.product.retailerId)).toEqual(["freshlane"]);
  await page.getByRole("button", { name: "Find my best basket" }).click();
  await expect(page.locator(".store-order")).toHaveCount(1);
  await expect(page.locator(".store-order h3")).toHaveText("Freshlane");
  await page.getByRole("checkbox", { name: /Freshlane/ }).uncheck();
  await page.getByRole("checkbox", { name: /Daily Basket/ }).uncheck();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.locator(".error-banner")).toBeVisible();
});

test("failed comparisons preserve the list and allow retry", async ({ page }) => {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.route("**/api/compare", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary service failure. Try again." }) }));
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.locator(".error-banner")).toContainText("Temporary service failure");
  await expect(page.getByTestId("shopping-item")).toHaveCount(5);
  await page.unroute("**/api/compare");
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Good matches. No surprises." })).toBeVisible();
});

test("a narrow 320px screen and reduced motion support the full journey", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Good matches. No surprises." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Find my best basket" }).click();
  await expect(page.getByTestId("basket-total")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Checkout preview", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await page.getByRole("dialog").boundingBox())!.width).toBeLessThanOrEqual(320);
});
