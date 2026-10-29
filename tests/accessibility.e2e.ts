import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("landing, match review, results and checkout pass WCAG accessibility scans", async ({ page }) => {
  await page.goto("/");
  const audit = async () => {
    // Audit the settled UI, after finite entry animations and transitions.
    await page.locator("body").evaluate(async body => {
      await Promise.all(body.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)));
    });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map(v => ({ id: v.id, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) }))).toEqual([]);
  };
  await audit();
  await page.getByRole("button", { name: "Try a weekly essentials list" }).click();
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Good matches. No surprises." })).toBeVisible();
  await audit();
  await page.getByRole("button", { name: "Find my best basket" }).click();
  await expect(page.getByTestId("basket-total")).toBeVisible();
  await audit();
  await page.getByRole("button", { name: "Checkout preview", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await audit();
});
