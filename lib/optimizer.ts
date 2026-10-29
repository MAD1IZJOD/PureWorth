import { feeSchema, roundedRatio, type Basket, type Charge, type ItemMatches, type Match, type OptimizationResult, type Retailer, type StoreOrder } from "./domain";

export const MAX_SEARCH_NODES = 200_000;
export type OptimizationOptions = {
  approved?: string[]; retailerIds?: string[]; maxRetailers?: number;
  fewerDeliveryTolerance?: number; nodeLimit?: number;
};

/** Fees are charged once, after the complete order has been allocated. */
export function priceOrder(retailer: Retailer, lines: Match[]): StoreOrder | null {
  if (!lines.length) return null;
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const f = retailer.fees;
  if (subtotal < f.minimumOrder) return null;
  const free = f.freeDeliveryAt !== null && subtotal >= f.freeDeliveryAt;
  const charges: Charge[] = [
    { label: "Delivery", amount: free ? 0 : f.delivery },
    { label: "Handling", amount: f.handling },
    { label: "Platform", amount: f.platform },
    { label: "Small-order fee", amount: subtotal < f.smallOrderBelow ? f.smallOrderFee : 0 },
    { label: "Other charges", amount: f.other },
  ];
  const offer = f.discount;
  const discount = offer?.confirmed && subtotal >= offer.minimum
    ? Math.min(subtotal, offer.cap, offer.fixed + roundedRatio(BigInt(subtotal) * BigInt(offer.basisPoints), 10_000n)) : 0;
  return { retailer, lines: [...lines], subtotal, charges, discount,
    total: subtotal + charges.reduce((sum, charge) => sum + charge.amount, 0) - discount,
    freeDeliveryGap: f.freeDeliveryAt === null ? 0 : Math.max(0, f.freeDeliveryAt - subtotal),
  };
}

const compare = (a: Basket, b: Basket) => a.total - b.total || a.orders.length - b.orders.length || a.key.localeCompare(b.key);

/** No price-only pruning: higher subtotals can unlock a cheaper final order. */
export function optimizeBasket(groups: ItemMatches[], retailers: Retailer[], options: OptimizationOptions = {}): OptimizationResult {
  if (!groups.length || groups.length > 12) throw new Error("Optimize between 1 and 12 items");
  const maxRetailers = options.maxRetailers ?? retailers.length;
  const tolerance = options.fewerDeliveryTolerance ?? 2000;
  const limit = options.nodeLimit ?? MAX_SEARCH_NODES;
  if (!Number.isSafeInteger(maxRetailers) || maxRetailers < 1 || !Number.isSafeInteger(tolerance) || tolerance < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SEARCH_NODES) throw new Error("Invalid optimization limits");
  const stores = retailers.filter(r => !options.retailerIds || options.retailerIds.includes(r.id)).map(r => ({ ...r, fees: feeSchema.parse(r.fees) }));
  if (new Set(stores.map(s => s.id)).size !== stores.length) throw new Error("Retailer IDs must be unique");
  const storeIds = new Set(stores.map(s => s.id));
  const approved = new Set(options.approved ?? []);
  const choices = [...groups].sort((a, b) => a.item.id.localeCompare(b.item.id)).map(group => ({
    item: group.item,
    matches: group.matches.filter(m => storeIds.has(m.product.retailerId) && m.product.available && (!m.requiresApproval || approved.has(m.id)))
      .sort((a, b) => a.lineTotal - b.lineTotal || a.id.localeCompare(b.id)),
  }));
  for (const group of choices) for (const match of group.matches) {
    if (!Number.isSafeInteger(match.lineTotal) || match.lineTotal < 0 || match.lineTotal > 100_000_000 * 1000) throw new Error("Invalid line amount");
  }
  const unavailable = choices.filter(c => !c.matches.length).map(c => c.item);
  const empty: OptimizationResult = { status: "infeasible", cheapest: null, singleStore: null, fewerDeliveries: null, reference: null, savings: null, unavailable, explored: 0, explanation: "" };
  if (unavailable.length) return { ...empty, explanation: "Some requested items have no eligible match. Review availability, selected stores or substitution approvals; no partial basket is presented as complete." };

  let explored = 0;
  let bounded = false;
  const bestByCount = new Map<number, Basket>();
  const allocation = new Map<string, Match[]>();
  function evaluate() {
    const orders: StoreOrder[] = [];
    for (const store of stores) {
      const lines = allocation.get(store.id);
      if (!lines?.length) continue;
      const order = priceOrder(store, lines);
      if (!order) return;
      orders.push(order);
    }
    orders.sort((a, b) => a.retailer.id.localeCompare(b.retailer.id));
    const allLines = orders.flatMap(o => o.lines);
    const basket: Basket = { orders, total: orders.reduce((sum, o) => sum + o.total, 0), key: allLines.map(m => m.id).sort().join("|"), substitutions: allLines.filter(m => m.requiresApproval) };
    const previous = bestByCount.get(orders.length);
    if (!previous || compare(basket, previous) < 0) bestByCount.set(orders.length, basket);
  }
  function search(depth: number, onlyStore?: string) {
    if (explored >= limit) { bounded = true; return; }
    explored++;
    if (depth === choices.length) { evaluate(); return; }
    for (const match of choices[depth].matches) {
      const id = match.product.retailerId;
      if (onlyStore && id !== onlyStore) continue;
      const existing = allocation.get(id);
      if (!existing && allocation.size >= maxRetailers) continue;
      if (existing) existing.push(match); else allocation.set(id, [match]);
      search(depth + 1, onlyStore);
      if (existing) existing.pop(); else allocation.delete(id);
      if (bounded) return;
    }
  }
  // Seed complete single-store baskets before the general search, so a bounded
  // search still has a meaningful reference and a fewer-deliveries candidate.
  for (const store of stores) {
    if (choices.every(c => c.matches.some(m => m.product.retailerId === store.id))) search(0, store.id);
    if (bounded) break;
  }
  if (!bounded) search(0);
  const candidates = [...bestByCount.values()].sort(compare);
  const cheapest = candidates[0] ?? null;
  const singleStore = bestByCount.get(1) ?? null;
  const fewerDeliveries = cheapest ? candidates.filter(b => b.total <= cheapest.total + tolerance)
    .sort((a, b) => a.orders.length - b.orders.length || compare(a, b))[0] : null;
  const reference = singleStore ? { label: `${bounded ? "Best found" : "Cheapest"} eligible single-store basket (${singleStore.orders[0].retailer.name})`, total: singleStore.total } : null;
  return {
    status: bounded ? "bounded" : cheapest ? "optimal" : "infeasible",
    cheapest, singleStore, fewerDeliveries, reference,
    savings: reference && cheapest ? reference.total - cheapest.total : null,
    unavailable: [], explored,
    explanation: bounded ? `Search stopped at ${limit.toLocaleString("en-IN")} allocation nodes. Results are the best found; optimality and infeasibility are not proven.`
      : cheapest ? `Evaluated complete allocations with delivery, handling, platform, small-order fees and confirmed demo offers. This is the lowest payable total among eligible matches, using at most ${maxRetailers} stores. Ties prefer fewer orders, then stable product IDs.`
      : "No complete basket satisfies the selected store limits and minimum order values. Try allowing more stores or adjusting quantities.",
  };
}
