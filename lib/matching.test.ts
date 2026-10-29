import { describe, expect, it } from "vitest";
import { demoAdapter, demoCatalog, retailers } from "./catalog";
import { comparisonSchema, itemSchema } from "./domain";
import { exampleList, matchProducts, normalizeQuantity, parseShoppingList } from "./matching";
import { optimizeBasket } from "./optimizer";

describe("normalization and list parsing", () => {
  it.each([["0.5", "kg", 500, "g"], ["1.25", "L", 1250, "ml"], ["12", "pieces", 12, "pieces"], ["2", "packs", 2, "packs"], ["500", "ml", 500, "ml"]])("normalizes %s %s exactly", (value, unit, quantity, canonical) => {
    expect(normalizeQuantity(String(value), String(unit))).toEqual({ quantity, unit: canonical });
  });
  it.each(["-1", "0", "0.0001", "NaN", "Infinity"])("rejects invalid quantity %s", value => expect(() => normalizeQuantity(value, "kg")).toThrow());
  it("parses the requested natural language example", () => {
    const items = parseShoppingList("2 litres milk, 5kg rice, 1kg dal, 12 eggs");
    expect(items.map(i => [i.quantity, i.unit])).toEqual([[2000, "ml"], [5000, "g"], [1000, "g"], [12, "pieces"]]);
  });
  it("recognizes brands, variants, and separate package counts", () => {
    expect(parseShoppingList("2 x 1 L Amul full cream milk")[0]).toMatchObject({ brand: "Amul", variant: "full cream", count: 2, quantity: 1000 });
  });
  it("handles newlines and semicolons", () => expect(parseShoppingList("milk 1L\nrice 5kg;12 eggs")).toHaveLength(3));
  it("keeps unknown items unmatched and unknown brands constrained", () => {
    expect(parseShoppingList("soap 2 packs")[0].category).toBe("unknown");
    expect(parseShoppingList("Acme rice 5kg")[0].brand).toBe("Acme");
  });
  it.each(["", "milk -1L", "milk 0 L", "milk 5", "21 x milk 1L", "rice 0.0001kg"])("rejects unsafe or ambiguous list %s", text => expect(() => parseShoppingList(text)).toThrow());
  it("limits request count and validates integer paise and quantities", () => {
    expect(() => parseShoppingList(Array(13).fill("milk").join(","))).toThrow();
    expect(itemSchema.safeParse({ ...parseShoppingList("milk")[0], count: 1.5 }).success).toBe(false);
    const item = parseShoppingList("milk")[0];
    expect(comparisonSchema.safeParse({ items: [item, item], location: "bengaluru", approved: [], retailerIds: ["freshlane"], maxRetailers: 1 }).success).toBe(false);
  });
});

describe("deterministic package and product matching", () => {
  const products = demoCatalog("bengaluru");
  it("separates exact brand matches from alternatives", () => {
    const g = matchProducts(parseShoppingList("Amul milk 1L"), products, "bengaluru")[0];
    expect(g.matches.find(m => m.product.id === "freshlane-milk")?.classification).toBe("exact");
    expect(g.matches.find(m => m.product.id === "freshlane-milk-alt")?.classification).toBe("similar");
    expect(g.matches.find(m => m.product.id === "freshlane-milk-rich")?.requiresApproval).toBe(true);
  });
  it("never presents one 1kg rice pack as a complete 5kg item", () => {
    const g = matchProducts(parseShoppingList("India Gate rice 5kg"), products, "bengaluru")[0];
    const small = g.matches.find(m => m.product.id === "freshlane-rice-small")!;
    expect(small.packs).toBe(5); expect(small.classification).toBe("equivalent");
    expect(small.requiresApproval).toBe(true); expect(small.lineTotal).toBe(59500);
    expect(small.packs * small.product.canonicalQuantity).toBe(5000);
  });
  it("rejects indivisible and oversized packages", () => {
    const g = matchProducts(parseShoppingList("rice 1.5kg"), products, "bengaluru")[0];
    expect(g.matches).toHaveLength(0); expect(g.rejected.some(r => r.reason.includes("exact requested quantity"))).toBe(true);
  });
  it("distinguishes pieces from generic packs and accounts for package count", () => {
    const eggs = matchProducts(parseShoppingList("12 eggs"), products, "bengaluru")[0].matches[0];
    expect(eggs.product.packageCount).toBe(2); expect(eggs.product.canonicalQuantity).toBe(12); expect(eggs.packs).toBe(1);
    expect(matchProducts(parseShoppingList("eggs 2 packs"), products, "bengaluru")[0].matches).toHaveLength(0);
  });
  it("recalculates line totals when quantities change", () => {
    const items = parseShoppingList("Amul milk 1L"); items[0].count = 3;
    const g = matchProducts(items, products, "bengaluru")[0];
    expect(g.matches.find(m => m.product.id === "freshlane-milk")?.lineTotal).toBe(20700);
  });
  it("respects location and availability", () => {
    expect(matchProducts(parseShoppingList("12 eggs"), demoCatalog("pune"), "pune")[0].matches.some(m => m.product.retailerId === "daily")).toBe(false);
    expect(matchProducts(parseShoppingList("milk"), products, "pune")[0].matches).toHaveLength(0);
  });
  it("fulfills the demo list with no unapproved substitutions", () => {
    const matches = matchProducts(parseShoppingList(exampleList), products, "bengaluru");
    const r = optimizeBasket(matches, retailers);
    expect(r.status).toBe("optimal"); expect(r.cheapest?.orders.flatMap(o => o.lines)).toHaveLength(5);
    expect(r.cheapest?.substitutions).toHaveLength(0);
    expect(r.cheapest!.total).toBeLessThanOrEqual(r.singleStore!.total);
  });
  it("exposes all demo adapter capabilities with explicit provenance", async () => {
    expect(demoAdapter.orderingSupported).toBe(false); expect(demoAdapter.freshness().live).toBe(false);
    const [p] = await demoAdapter.search("Amul milk", "bengaluru");
    expect((await demoAdapter.getProduct(p.id, "bengaluru"))?.source).toBe("fictional-demo-fixture");
    expect(await demoAdapter.getProduct("missing", "bengaluru")).toBeNull();
    expect(await demoAdapter.getPrices([p.id], "bengaluru")).toEqual([{ id: p.id, price: p.price }]);
    expect(await demoAdapter.getAvailability([p.id], "bengaluru")).toEqual([{ id: p.id, available: true }]);
    expect(await demoAdapter.getFeeRules("missing", "bengaluru")).toBeNull();
    expect(await demoAdapter.getRetailers("bengaluru")).toHaveLength(3);
  });
});
