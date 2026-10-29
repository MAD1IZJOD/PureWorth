import { test, expect } from "@playwright/test";
import type { Basket, ComparisonResponse, FeeRules, Location, Match } from "../lib/domain";
import { rupees } from "../lib/domain";
import { exampleList } from "../lib/matching";

type Scenario = { name: string; text: string; total?: number; infeasible?: boolean; approve?: boolean; location?: Location; stores?: string[]; max?: number; quantity?: number; bounded?: boolean };
const scenarios: Scenario[] = [
  { name: "single milk with small-order fees", text: "Amul milk 1 L", total: 11600 },
  { name: "two requested packs and minimum order", text: "2 x 1 L Amul milk", total: 16800 },
  { name: "whole weekly basket split across retailers", text: exampleList, total: 103900 },
  { name: "single-retailer restriction", text: exampleList, max: 1, total: 105500 },
  { name: "millilitres match litre packages", text: "Amul milk 1000 ml", total: 11600 },
  { name: "grams match kilogram packages", text: "India Gate rice 5000 g", total: 55400 },
  { name: "leading decimal milk cannot become five litres", text: "Amul milk .5 L", quantity: 500, infeasible: true },
  { name: "fractional rice stays unavailable", text: "India Gate rice 0.5 kg", quantity: 500, infeasible: true },
  { name: "package change rejected without approval", text: "Amul milk 2 L", infeasible: true },
  { name: "approved package and brand alternatives", text: "Amul milk 2 L", approve: true, total: 15800 },
  { name: "explicit rice brand preference", text: "Daawat rice 5 kg", total: 51100 },
  { name: "Pune out-of-stock eggs excluded", text: "12 eggs", location: "pune", total: 14300 },
  { name: "Hyderabad unavailable requested brand", text: "Nandini milk 1 L", location: "hyderabad", infeasible: true },
  { name: "unknown product never produces a partial basket", text: "Amul milk 1 L, soap 2 packs", infeasible: true },
  { name: "mass and volume are incompatible", text: "Fortune oil 1 kg", infeasible: true },
  { name: "indivisible rice package", text: "rice 1.5 kg", infeasible: true },
  { name: "packs and pieces remain distinct", text: "eggs 2 packs", infeasible: true },
  { name: "explicit full-cream variant", text: "Amul full cream milk 1 L", total: 12500 },
  { name: "tea quarter-kilogram", text: "Tata Tea premium tea 250 g", total: 19500 },
  { name: "curd stock and retailer minimums", text: "Amul curd 400 g", total: 9200 },
  { name: "piece count for fruit", text: "6 pieces bananas", total: 9600 },
  { name: "sugar small-cart fees", text: "Madhur sugar 1 kg", total: 9900 },
  { name: "three products just below free delivery", text: "Aashirvaad atta 5 kg, Amul milk 1 L, Tata Sampann dal 1 kg", stores: ["freshlane"], total: 52900 },
  { name: "exact free-delivery threshold", text: "Tata Sampann dal 1 kg, 8 x 400 g Amul curd", stores: ["freshlane"], total: 50600 },
  { name: "just below small-order threshold", text: "Tata Tea premium tea 250 g, 6 bananas", stores: ["freshlane"], total: 24500 },
  { name: "exact small-order threshold", text: "Madhur sugar 1 kg, 3 x 6 pieces bananas", stores: ["freshlane"], total: 23100 },
  { name: "confirmed Pantry discount eligibility", text: exampleList, stores: ["pantry"], total: 106800 },
  { name: "12-line search hits the actual node cap", text: Array(12).fill("Amul milk 1 L").join(", "), bounded: true, total: 79900 },
];

/** Independent fee oracle, not an import of the implementation under audit. */
function orderTotal(subtotal: number, f: FeeRules): number | null {
  if (subtotal < f.minimumOrder) return null;
  const delivery = f.freeDeliveryAt !== null && subtotal >= f.freeDeliveryAt ? 0 : f.delivery;
  const small = subtotal < f.smallOrderBelow ? f.smallOrderFee : 0;
  const offer = f.discount;
  const percent = offer ? Number((BigInt(subtotal) * BigInt(offer.basisPoints) + 5000n) / 10000n) : 0;
  const discount = offer?.confirmed && subtotal >= offer.minimum ? Math.min(subtotal, offer.cap, offer.fixed + percent) : 0;
  return subtotal + delivery + f.handling + f.platform + small + f.other - discount;
}

function verifyBasket(basket: Basket, data: ComparisonResponse, approved: Set<string>) {
  const lines = basket.orders.flatMap(o => o.lines);
  expect(lines.map(l => l.itemId).sort()).toEqual(data.matches.map(g => g.item.id).sort());
  let total = 0;
  for (const order of basket.orders) {
    for (const line of order.lines) {
      const item = data.matches.find(g => g.item.id === line.itemId)!.item;
      expect(line.product.available).toBe(true);
      expect(line.product.canonicalUnit).toBe(item.unit);
      expect(line.packs * line.product.canonicalQuantity).toBe(item.quantity * item.count);
      expect(line.lineTotal).toBe(line.product.price * line.packs);
      expect(!line.requiresApproval || approved.has(line.id)).toBe(true);
    }
    expect(order.subtotal).toBe(order.lines.reduce((sum, l) => sum + l.lineTotal, 0));
    expect(order.total).toBe(orderTotal(order.subtotal, order.retailer.fees));
    expect(order.total).toBe(order.subtotal + order.charges.reduce((sum, c) => sum + c.amount, 0) - order.discount);
    expect(order.charges.filter(c => c.label === "Delivery")).toHaveLength(1);
    total += order.total;
  }
  expect(basket.total).toBe(total);
}

function exhaustiveTotal(data: ComparisonResponse, approved: Set<string>, maxStores: number): number {
  const choices = data.matches.map(g => g.matches.filter(m => !m.requiresApproval || approved.has(m.id)));
  const selected: Match[] = [];
  let best = Infinity;
  function visit(depth: number) {
    if (depth === choices.length) {
      const subtotals = new Map<string, number>();
      selected.forEach(m => subtotals.set(m.product.retailerId, (subtotals.get(m.product.retailerId) ?? 0) + m.lineTotal));
      if (subtotals.size > maxStores) return;
      let sum = 0;
      for (const [id, subtotal] of subtotals) {
        const total = orderTotal(subtotal, data.retailers.find(r => r.id === id)!.fees);
        if (total === null) return;
        sum += total;
      }
      best = Math.min(best, sum); return;
    }
    for (const match of choices[depth]) { selected.push(match); visit(depth + 1); selected.pop(); }
  }
  visit(0); return best;
}

for (const scenario of scenarios) test(`grocery audit: ${scenario.name}`, async ({ page }, info) => {
  const diagnostics: string[] = [];
  page.on("pageerror", e => diagnostics.push(e.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) diagnostics.push(message.text()); });
  await page.goto("/");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByLabel("What’s on your list?").fill(scenario.text);
  await page.getByRole("button", { name: "Build my list", exact: true }).click();
  await expect(page.getByTestId("shopping-item")).toHaveCount(scenario.text.split(",").length);
  if (scenario.location) await page.getByLabel("Demo service area").selectOption(scenario.location);
  if (scenario.max) await page.getByLabel("Maximum store orders").selectOption(String(scenario.max));
  if (scenario.stores) for (const store of ["Freshlane", "Daily Basket", "Pantry Club"]) {
    const id = { Freshlane: "freshlane", "Daily Basket": "daily", "Pantry Club": "pantry" }[store]!;
    await page.getByRole("checkbox", { name: new RegExp(store) }).setChecked(scenario.stores.includes(id));
  }
  await page.getByRole("button", { name: "Compare my list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Good matches. No surprises." })).toBeVisible();
  const review = page.locator("#match-review");
  if (scenario.approve) {
    for (const summary of await review.locator(".alternatives summary").all()) await summary.click();
    for (const checkbox of await review.getByRole("checkbox").all()) await checkbox.check();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const promise = page.waitForResponse(r => r.url().endsWith("/api/compare") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Find my best basket", exact: true }).click();
  const response = await promise;
  expect(response.status()).toBe(200);
  const request = response.request().postDataJSON();
  const approved = new Set<string>(request.approved);
  const data: ComparisonResponse = await response.json();
  if (scenario.quantity) expect(data.matches[0].item.quantity).toBe(scenario.quantity);
  if (scenario.infeasible) {
    expect(data.result.status).toBe("infeasible"); expect(data.result.cheapest).toBeNull();
    expect(data.result.savings).toBeNull();
    await expect(page.getByTestId("basket-total")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "We can’t fulfill this complete list yet." })).toBeVisible();
  } else {
    expect(data.result.status).toBe(scenario.bounded ? "bounded" : "optimal");
    expect(data.result.cheapest!.total).toBe(scenario.total);
    await expect(page.getByTestId("basket-total")).toHaveText(rupees(scenario.total!));
    for (const basket of [data.result.cheapest, data.result.singleStore, data.result.fewerDeliveries]) if (basket) verifyBasket(basket, data, approved);
    expect(data.result.reference?.total).toBe(data.result.singleStore?.total);
    expect(data.result.savings).toBe(data.result.singleStore!.total - data.result.cheapest!.total);
    if (scenario.bounded) {
      expect(data.result.explored).toBe(200000);
      expect(data.result.reference!.label).toContain("Best found");
      await expect(page.getByRole("button", { name: /Best basket found/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Fewer deliveries found/ })).toContainText("best total found");
      await expect(page.locator("#comparison-results")).not.toContainText("lowest total");
    }
  }
  if (!scenario.bounded) {
    const oracle = exhaustiveTotal(data, approved, scenario.max ?? 3);
    expect(data.result.cheapest?.total ?? Infinity).toBe(oracle);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (scenario.name === "whole weekly basket split across retailers") await page.locator("#comparison-results").screenshot({ path: info.outputPath("audited-cart.png"), animations: "disabled" });
  expect(diagnostics).toEqual([]);
});
