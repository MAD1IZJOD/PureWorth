import { describe, expect, it } from "vitest";
import { demoCatalog, retailers } from "./catalog";
import { roundedRatio, type FeeRules, type ItemMatches, type Match, type Retailer } from "./domain";
import { parseShoppingList } from "./matching";
import { optimizeBasket, priceOrder } from "./optimizer";

const free: FeeRules = { delivery: 0, freeDeliveryAt: null, minimumOrder: 0, handling: 0, platform: 0, smallOrderBelow: 0, smallOrderFee: 0, other: 0, discount: null };
function store(id: string, fees: Partial<FeeRules> = {}): Retailer { return { id, name: id, initials: id, color: "green", fees: { ...free, ...fees } }; }
function group(index: number, entries: [string, number][]): ItemMatches {
  const item = { ...parseShoppingList("milk 1 L")[0], id: `item-${index}` };
  const matches: Match[] = entries.map(([id, price]) => ({
    id: `${item.id}:${id}`, itemId: item.id, product: { ...demoCatalog("bengaluru")[0], id: `${id}-${index}`, retailerId: id, price },
    packs: 1, classification: "exact", reason: "test fixture", requiresApproval: false, lineTotal: price,
  }));
  return { item, matches, rejected: [] };
}

describe("complete basket optimization", () => {
  it("handles one item and one store", () => expect(optimizeBasket([group(0, [["a", 6500]])], [store("a")]).cheapest?.total).toBe(6500));
  it("charges delivery once for ten items", () => {
    const r = optimizeBasket(Array.from({ length: 10 }, (_, i) => group(i, [["a", 1000]])), [store("a", { delivery: 2000 })]);
    expect(r.cheapest?.total).toBe(12000);
    expect(r.cheapest?.orders[0].charges.find(c => c.label === "Delivery")?.amount).toBe(2000);
  });
  it("splits the cart when the final payable cost is lower", () => {
    const r = optimizeBasket([group(0, [["a", 5000], ["b", 9000]]), group(1, [["a", 9000], ["b", 5000]])], [store("a", { delivery: 500 }), store("b", { delivery: 500 })]);
    expect(r.cheapest?.total).toBe(11000); expect(r.cheapest?.orders).toHaveLength(2);
    expect(r.singleStore?.total).toBe(14500); expect(r.savings).toBe(3500);
  });
  it("beats adversarial greedy item selection: 160 rather than 170 rupees", () => {
    const r = optimizeBasket([group(0, [["a", 7000], ["b", 6500]]), group(1, [["a", 9000], ["b", 8500]])], [store("a"), store("b", { delivery: 2000 })]);
    expect(r.cheapest?.total).toBe(16000); expect(r.cheapest?.orders[0].retailer.id).toBe("a");
  });
  it.each([[19999, 22499], [20000, 20000], [20001, 20001]])("applies free delivery at an exact threshold %i", (price, total) => {
    expect(optimizeBasket([group(0, [["a", price]])], [store("a", { delivery: 2500, freeDeliveryAt: 20000 })]).cheapest?.total).toBe(total);
  });
  it("keeps higher item prices that unlock free delivery", () => {
    const g = group(0, [["a", 19900], ["a", 20000]]);
    g.matches[1].id += "-premium";
    const r = optimizeBasket([g], [store("a", { delivery: 2500, freeDeliveryAt: 20000 })]);
    expect(r.cheapest?.total).toBe(20000);
  });
  it("enforces minimum order values after allocation", () => {
    const r = optimizeBasket([group(0, [["a", 5000], ["b", 6000]])], [store("a", { minimumOrder: 10000 }), store("b")]);
    expect(r.cheapest?.total).toBe(6000);
  });
  it("returns infeasible when every store minimum fails", () => {
    expect(optimizeBasket([group(0, [["a", 5000]])], [store("a", { minimumOrder: 10000 })]).status).toBe("infeasible");
  });
  it("excludes out-of-stock products", () => {
    const g = group(0, [["a", 100], ["b", 200]]); g.matches[0].product.available = false;
    expect(optimizeBasket([g], [store("a"), store("b")]).cheapest?.total).toBe(200);
  });
  it("does not invent missing products or report partial totals", () => {
    const r = optimizeBasket([group(0, [])], [store("a")]);
    expect(r.status).toBe("infeasible"); expect(r.cheapest).toBeNull(); expect(r.unavailable).toHaveLength(1); expect(r.savings).toBeNull();
  });
  it("requires explicit approval of alternatives", () => {
    const g = group(0, [["a", 100]]); g.matches[0].requiresApproval = true; g.matches[0].classification = "similar";
    expect(optimizeBasket([g], [store("a")]).cheapest).toBeNull();
    expect(optimizeBasket([g], [store("a")], { approved: [g.matches[0].id] }).cheapest?.substitutions).toHaveLength(1);
  });
  it("uses deterministic IDs to break equal-price ties", () => {
    const g = group(0, [["b", 100], ["a", 100]]);
    const a = optimizeBasket([g], [store("b"), store("a")]);
    const b = optimizeBasket([{ ...g, matches: [...g.matches].reverse() }], [store("a"), store("b")]);
    expect(a.cheapest?.key).toBe(b.cheapest?.key); expect(a.cheapest?.orders[0].retailer.id).toBe("a");
  });
  it("prefers fewer stores when totals tie", () => {
    const r = optimizeBasket([group(0, [["a", 100], ["b", 100]]), group(1, [["a", 100], ["b", 100]])], [store("a"), store("b")]);
    expect(r.cheapest?.orders).toHaveLength(1);
  });
  it("honors the retailer limit and restrictions", () => {
    const groups = [group(0, [["a", 100], ["b", 300]]), group(1, [["a", 300], ["b", 100]])];
    expect(optimizeBasket(groups, [store("a"), store("b")], { maxRetailers: 1 }).cheapest?.total).toBe(400);
    expect(optimizeBasket(groups, [store("a"), store("b")], { retailerIds: ["b"] }).cheapest?.orders[0].retailer.id).toBe("b");
  });
  it("finds fewer deliveries within a specified paise tolerance", () => {
    const groups = [group(0, [["a", 100], ["b", 110]]), group(1, [["a", 110], ["b", 100]])];
    expect(optimizeBasket(groups, [store("a"), store("b")], { fewerDeliveryTolerance: 10 }).fewerDeliveries?.orders).toHaveLength(1);
    expect(optimizeBasket(groups, [store("a"), store("b")], { fewerDeliveryTolerance: 9 }).fewerDeliveries?.orders).toHaveLength(2);
  });
  it("calculates confirmed discounts, all fees, and small-order boundaries", () => {
    const s = store("a", { delivery: 100, handling: 200, platform: 300, other: 400, smallOrderBelow: 10000, smallOrderFee: 500, discount: { label: "offer", minimum: 0, fixed: 100, basisPoints: 1000, cap: 5000, confirmed: true } });
    expect(priceOrder(s, group(0, [["a", 9999]]).matches)?.total).toBe(10399);
    expect(priceOrder(s, group(0, [["a", 10000]]).matches)?.total).toBe(9900);
    s.fees.discount!.confirmed = false;
    expect(priceOrder(s, group(0, [["a", 10000]]).matches)?.total).toBe(11000);
  });
  it("caps discounts and never creates negative order values", () => {
    const s = store("a", { discount: { label: "offer", minimum: 0, fixed: 20000, basisPoints: 0, cap: 5000, confirmed: true } });
    expect(priceOrder(s, group(0, [["a", 1000]]).matches)?.total).toBe(0);
  });
  it("has no savings claim without a valid single-store reference", () => {
    const r = optimizeBasket([group(0, [["a", 100]]), group(1, [["b", 100]])], [store("a"), store("b")]);
    expect(r.cheapest?.total).toBe(200); expect(r.reference).toBeNull(); expect(r.savings).toBeNull();
  });
  it("labels a budget-limited search honestly", () => {
    const r = optimizeBasket([group(0, [["a", 100], ["b", 50]])], [store("a"), store("b")], { nodeLimit: 2 });
    expect(r.status).toBe("bounded"); expect(r.explored).toBe(2); expect(r.explanation).toContain("not proven");
  });
  it("rejects invalid numeric options", () => {
    expect(() => optimizeBasket([group(0, [["a", 100]])], [store("a")], { fewerDeliveryTolerance: 0.5 })).toThrow();
  });
  it("rounds money half up exactly with BigInt", () => {
    expect(roundedRatio(10005n, 10n)).toBe(1001);
    expect(roundedRatio(10004n, 10n)).toBe(1000);
    expect(() => roundedRatio(1n, 0n)).toThrow();
  });

  it("matches an independent exhaustive oracle across 40 varied fee scenarios", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const stores = [store("a", { delivery: 1000, freeDeliveryAt: 18000, minimumOrder: seed % 2 ? 0 : 7000 }), store("b", { handling: 400, smallOrderBelow: 12000, smallOrderFee: 900 }), store("c", { delivery: 800, platform: 200 })];
      const groups = [0, 1, 2].map(i => group(i, stores.map((s, j) => [s.id, 3000 + ((seed * 137 + i * 839 + j * 277) % 8000)])));
      let oracle = Infinity;
      for (const x of groups[0].matches) for (const y of groups[1].matches) for (const z of groups[2].matches) {
        let total = 0, valid = true;
        for (const s of stores) {
          const lines = [x, y, z].filter(m => m.product.retailerId === s.id);
          if (!lines.length) continue;
          const sub = lines.reduce((n, m) => n + m.lineTotal, 0), f = s.fees;
          if (sub < f.minimumOrder) { valid = false; break; }
          total += sub + (f.freeDeliveryAt !== null && sub >= f.freeDeliveryAt ? 0 : f.delivery) + f.handling + f.platform + (sub < f.smallOrderBelow ? f.smallOrderFee : 0);
        }
        if (valid) oracle = Math.min(oracle, total);
      }
      expect(optimizeBasket(groups, stores).cheapest?.total).toBe(oracle);
    }
  });
  it("the demo retailers all have validated fee models", () => expect(retailers).toHaveLength(3));
});
