import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => { await page.goto("/"); await page.emulateMedia({ reducedMotion: "reduce" }); });

test("skip link, navigation, footer links and retailer disclosure work", async ({ page }) => {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to shopping list" });
  await expect(skip).toBeFocused(); await skip.press("Enter");
  await expect(page.locator("#shopping-list")).toBeFocused();
  // The keyboard-only skip link was exercised above; it returns off screen.
  for (const link of await page.locator("a[href^='#']:not(.skip-link)").all()) {
    const hash = await link.getAttribute("href");
    expect(hash).not.toBe("#");
    await expect(page.locator(hash!)).toHaveCount(1);
    if (await link.isVisible()) { await link.click(); await expect(page).toHaveURL(new RegExp(`${hash}$`)); }
  }
  const disclosure = page.locator("#data-and-trust details");
  await disclosure.locator("summary").click(); await expect(disclosure).toHaveAttribute("open", "");
  await expect(disclosure.getByText(/These are future integration candidates/)).toBeVisible();
  await disclosure.locator("summary").click(); await expect(disclosure).not.toHaveAttribute("open", "");
});

test("quantity replacement, invalid edits, counters and empty-list recovery work", async ({ page }) => {
  await page.getByLabel("Add a grocery item", { exact: true }).fill("Amul milk 1 L");
  await page.getByRole("button", { name: "Add grocery item", exact: true }).click();
  const row = page.getByTestId("shopping-item");
  await row.getByText("Edit size & brand").click();
  const quantity = row.getByLabel("Package quantity for Amul milk", { exact: true });
  await quantity.fill(""); await expect(quantity).toHaveValue("");
  await quantity.pressSequentially("500"); await quantity.press("Enter");
  await expect(row.locator(".item-info > p")).toContainText("500 ml");
  await quantity.fill("0"); await quantity.press("Tab");
  await expect(quantity).toHaveValue("500");
  await expect(row.getByRole("alert")).toContainText("previous size was kept");
  await quantity.fill("1000"); await quantity.press("Enter");
  await expect(row.getByRole("alert")).toHaveCount(0);
  const increase = row.getByRole("button", { name: "Increase Amul milk", exact: true });
  const decrease = row.getByRole("button", { name: "Decrease Amul milk", exact: true });
  await expect(decrease).toBeDisabled();
  for (let count = 1; count < 20; count++) await increase.click();
  await expect(row.locator(".stepper span")).toHaveText("20"); await expect(increase).toBeDisabled();
  for (let count = 20; count > 1; count--) await decrease.click();
  await expect(decrease).toBeDisabled();
  await row.getByRole("button", { name: "Remove Amul milk", exact: true }).click();
  await expect(page.getByRole("button", { name: "Compare my list", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Load the example list", exact: true }).click();
  await expect(page.getByTestId("shopping-item")).toHaveCount(5);
});

test("all mutating controls are disabled while comparing and checkout returns focus", async ({ page }) => {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/compare", async route => { await gate; await route.continue(); });
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  try {
    await expect(page.getByRole("status")).toContainText("Checking package sizes");
    await expect(page.getByLabel("What’s on your list?")).toBeDisabled();
    await expect(page.getByLabel("Demo service area")).toBeDisabled();
    await expect(page.getByLabel("Maximum store orders")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add grocery item", exact: true })).toBeDisabled();
    for (const checkbox of await page.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled();
  } finally { release(); }
  await expect(page.locator("#match-review")).toBeFocused();
  await page.getByRole("button", { name: "Find my best basket", exact: true }).click();
  await expect(page.locator("#comparison-results")).toBeFocused();
  const checkout = page.getByRole("button", { name: "Checkout preview", exact: true });
  await checkout.click();
  await expect(page.getByRole("button", { name: "Ordering unavailable in demo" })).toBeDisabled();
  await page.getByRole("button", { name: "Back to my basket", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible(); await expect(checkout).toBeFocused();
});

test("revoking alternatives and changing brands invalidates the comparison", async ({ page }) => {
  await page.getByLabel("What’s on your list?").fill("Amul milk 2 L");
  await page.getByRole("button", { name: "Build my list", exact: true }).click();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await page.locator(".alternatives summary").click();
  const alternative = page.locator(".match-card").filter({ hasText: "Freshlane" }).filter({ hasText: "Amul Taaza toned milk" }).getByRole("checkbox");
  await alternative.check(); await alternative.uncheck();
  await page.getByRole("button", { name: "Find my best basket", exact: true }).click();
  await expect(page.getByTestId("basket-total")).toHaveCount(0);
  await page.getByRole("button", { name: "Review product matches", exact: true }).click();
  await page.locator(".alternatives summary").click(); await alternative.check();
  await page.getByRole("button", { name: "Find my best basket", exact: true }).click();
  await expect(page.getByTestId("basket-total")).toBeVisible();
  const row = page.getByTestId("shopping-item"); await row.getByText("Edit size & brand").click();
  await row.getByLabel("Brand for Amul milk", { exact: true }).fill("Nandini");
  await expect(page.locator("#comparison-results")).toHaveCount(0);
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await page.locator(".alternatives summary").click();
  for (const checkbox of await page.locator("#match-review").getByRole("checkbox").all()) await expect(checkbox).not.toBeChecked();
});

test("ambiguous input errors are visible, focused and preserve the list", async ({ page }) => {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  for (const input of ["Amul lactose free milk 1 L", "Amul milk 1L 500ml", "Amul milk 1/2L"]) {
    await page.getByLabel("What’s on your list?").fill(input);
    await page.getByRole("button", { name: "Build my list", exact: true }).click();
    await expect(page.locator("#shopping-error")).toBeFocused();
    await expect(page.locator("#shopping-error")).toBeInViewport();
    await expect(page.getByTestId("shopping-item")).toHaveCount(5);
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  }
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.uncheck();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.locator("#shopping-error")).toContainText("Choose at least one demo store");
});

test("HTML gateway failures show a useful error and allow retry", async ({ page }) => {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.route("**/api/compare", route => route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad gateway</html>" }));
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.locator("#shopping-error")).toContainText("Could not read the comparison response");
  await expect(page.getByTestId("shopping-item")).toHaveCount(5);
  await page.unroute("**/api/compare");
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.locator("#match-review")).toBeVisible();
});

test("two-store limits and every delivery-budget option reach the optimizer", async ({ page }) => {
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.getByLabel("Maximum store orders").selectOption("2");
  for (const budget of ["0", "1000", "2000", "5000"]) {
    await page.getByLabel("Extra budget for fewer deliveries").selectOption(budget);
    await page.getByRole("button", { name: "Compare my list", exact: true }).click();
    await expect(page.locator("#match-review")).toBeVisible();
    const promise = page.waitForResponse(r => r.url().endsWith("/api/compare"));
    await page.getByRole("button", { name: "Find my best basket", exact: true }).click();
    const response = await promise;
    expect(response.request().postDataJSON()).toMatchObject({ maxRetailers: 2, fewerDeliveryTolerance: Number(budget) });
    await page.getByRole("button", { name: /Fewer deliveries/ }).click();
    await expect(page.locator(".store-order")).toHaveCount(Number(budget) < 1600 ? 2 : 1);
  }
});

test("long brand constraints and long validation messages fit the screen", async ({ page }) => {
  await page.getByLabel("What’s on your list?").fill(`${"W".repeat(50)} rice 1 kg`);
  await page.getByRole("button", { name: "Build my list", exact: true }).click();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.locator("#match-review")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("What’s on your list?").fill(`Amul ${"W".repeat(120)} milk 1 L`);
  await page.getByRole("button", { name: "Build my list", exact: true }).click();
  await expect(page.locator("#shopping-error")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
