import { describe, expect, it } from "vitest";
import { demoCatalog, retailers } from "./catalog";
import { exampleList, matchProducts, normalizeQuantity, parseShoppingList } from "./matching";
import { optimizeBasket } from "./optimizer";

describe("stabilization regressions", () => {
  it("accepts a leading decimal without multiplying the requested amount", () => {
    expect(normalizeQuantity(".5", "L")).toEqual({ quantity: 500, unit: "ml" });
    expect(parseShoppingList("Amul milk .5 L")[0]).toMatchObject({ quantity: 500, unit: "ml", brand: "Amul" });
    expect(parseShoppingList("rice .5kg")[0].quantity).toBe(500);
  });
  it.each(["Amul lactose free milk 1L", "India Gate premium rice 5kg", "Amul basmati milk 1L", "Amul milk 1L 500ml", "Amul milk 1/2L"])("does not discard important or ambiguous details: %s", text => {
    expect(() => parseShoppingList(text)).toThrow();
  });
  it("does not recognize a brand inside a different brand name", () => {
    expect(parseShoppingList("Amulya milk 1L")[0].brand).toBe("Amulya");
  });
  it("keeps unknown brands and explicit variants as constraints", () => {
    expect(parseShoppingList("Acme rice 5kg")[0].brand).toBe("Acme");
    expect(parseShoppingList("Amul full cream milk 1L")[0].variant).toBe("full cream");
    expect(parseShoppingList("India Gate brown rice 5kg")[0].variant).toBe("brown");
  });
  it("never claims savings without a complete valid single-store reference", () => {
    const matches = matchProducts(parseShoppingList("Amul curd 400g, India Gate rice 5kg"), demoCatalog("bengaluru"), "bengaluru");
    matches[0].matches = matches[0].matches.filter(m => m.product.retailerId === "freshlane");
    matches[1].matches = matches[1].matches.filter(m => m.product.retailerId === "pantry" && !m.requiresApproval);
    const result = optimizeBasket(matches, retailers);
    expect(result.status).toBe("optimal"); expect(result.cheapest?.total).toBe(64600);
    expect(result.singleStore).toBeNull(); expect(result.reference).toBeNull(); expect(result.savings).toBeNull();
  });
  it("never calls a capped search without a basket infeasible", () => {
    const matches = matchProducts(parseShoppingList(exampleList), demoCatalog("bengaluru"), "bengaluru");
    const result = optimizeBasket(matches, retailers, { nodeLimit: 1 });
    expect(result.status).toBe("bounded"); expect(result.cheapest).toBeNull();
    expect(result.explanation).toContain("not proven"); expect(result.reference).toBeNull(); expect(result.savings).toBeNull();
  });
  it("returns a valid best-found reference when capped after finding a basket", () => {
    const matches = matchProducts(parseShoppingList(exampleList), demoCatalog("bengaluru"), "bengaluru");
    const result = optimizeBasket(matches, retailers, { nodeLimit: 6 });
    expect(result.status).toBe("bounded"); expect(result.reference?.label).toContain("Best found");
    const reference = result.singleStore!;
    expect(reference.orders.flatMap(o => o.lines)).toHaveLength(5);
    expect(result.savings).toBe(reference.total - result.cheapest!.total);
  });
});
