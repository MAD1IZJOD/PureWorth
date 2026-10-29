import { describe, expect, it } from "vitest";
import { demoCatalog, retailers } from "../catalog";
import { matchProducts, parseShoppingList } from "../matching";
import { optimizeBasket } from "../optimizer";
import { basketQuoteSchema, offerSchema, type BasketQuote, type Offer, type QuoteRequest } from "./contracts";
import { demoLocation, locationKey } from "./location";
import { applyQuote, comparableSavings, quoteFingerprint, validateQuote, type SavingsEvidence } from "./quotes";
import { ReferenceProvider, simulatedTransport, type ReferenceTransport } from "./reference";
import { ProviderExecutor, simulationAccessPolicy } from "./reliability";

const now = Date.parse("2026-10-29T10:00:00Z");
const location = demoLocation("bengaluru");
const makeProvider = (id = "freshlane", transport?: ReferenceTransport, clock: () => number = () => now) => new ReferenceProvider(id, new ProviderExecutor(id, simulationAccessPolicy, clock), transport ?? simulatedTransport(id, "normal", clock), clock);
const request = (packs = 2): QuoteRequest => ({ location, conditionsKey: "public-demo", lines: [{ offerId: "freshlane-milk", packs }] });
async function quote(): Promise<BasketQuote> {
  const result = await makeProvider().getBasketQuote(request());
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
async function offer(): Promise<Offer> {
  const result = await makeProvider().getProductDetails("freshlane-milk", location);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("simulated authorized provider contract", () => {
  it("implements search, details, offers, coverage, health and capabilities", async () => {
    const provider = makeProvider();
    const catalog = await provider.getCatalogOffers(location), search = await provider.searchProducts("Amul milk", location);
    expect(catalog.ok && catalog.value.offers).toHaveLength(14);
    expect(search.ok && search.value.offers.every(o => /Amul.*milk/.test(o.product.name))).toBe(true);
    expect((await provider.getProductDetails("freshlane-milk", location)).ok).toBe(true);
    expect(await provider.getLocationAvailability(location)).toMatchObject({ ok: true, value: { status: "available", itemEligibilityConfirmed: false } });
    expect((await provider.getProviderHealth()).status).toBe("HEALTHY");
    expect(provider.getCapabilities().ordering.state).toBe("UNSUPPORTED");
    expect(provider.getCapabilities().catalogSearch).toMatchObject({ scope: "SIMULATION" });
  });
  it("keeps fixture provenance separate from the response collection time", async () => {
    const value = await offer();
    expect(value.sourceId).toBe("fictional-demo-fixture@2026-10-01");
    expect(value.sourceType).toBe("SIMULATED_AUTHORIZED"); expect(value.verifiedAt).toBeNull();
    expect(Date.parse(value.collectedAt)).toBe(now); expect(value.context).toBe("LOCATION_PRICE");
  });
  it("has location-specific stock and cannot reuse another area's result", async () => {
    const provider = makeProvider("daily");
    expect(await provider.getProductDetails("daily-eggs", demoLocation("pune"))).toMatchObject({ ok: true, value: { stock: "OUT_OF_STOCK" } });
    expect(await provider.getProductDetails("daily-eggs", location)).toMatchObject({ ok: true, value: { stock: "IN_STOCK" } });
    expect(await provider.getCatalogOffers(demoLocation("pune", "999999"))).toMatchObject({ ok: false, error: { code: "LOCATION_UNSUPPORTED" } });
  });
  it("rejects malformed responses, wrong providers, locations and fabricated live source labels", async () => {
    const value = await offer();
    for (const invalid of [{ nonsense: true }, { ...value, product: { ...value.product, price: 1.2 } }, { ...value, sourceType: "AUTHORIZED_API" }, { ...value, locationKey: "elsewhere" }, { ...value, product: { ...value.product, retailerId: "blinkit" } }]) {
      const provider = makeProvider("freshlane", async () => ({ ok: true, value: { offers: [invalid], complete: true, warnings: [] } }));
      expect(await provider.getCatalogOffers(location)).toMatchObject({ ok: false, error: { code: "INVALID_RESPONSE" } });
    }
  });
  it("reports partial catalogs explicitly without inventing missing products", async () => {
    const provider = makeProvider("freshlane", simulatedTransport("freshlane", "partial", () => now));
    const result = await provider.getCatalogOffers(location);
    expect(result.ok && result.value.complete).toBe(false);
    expect(result.ok && result.value.offers).toHaveLength(7);
    expect(result.ok && result.value.warnings[0].code).toBe("UNAVAILABLE");
  });
  it("caches a snapshot briefly and explicitly invalidates it", async () => {
    let clock = now, calls = 0;
    const base = simulatedTransport("freshlane", "normal", () => clock);
    const provider = makeProvider("freshlane", async (...args) => { calls++; return base(...args); }, () => clock);
    await provider.getCatalogOffers(location); clock += 1000; await provider.getCatalogOffers(location); expect(calls).toBe(1);
    provider.invalidate(location); await provider.getCatalogOffers(location); expect(calls).toBe(2);
    clock += 30_000; await provider.getCatalogOffers(location); expect(calls).toBe(3);
  });
  it("validates exact unit price ratios and package counts without decimal money", async () => {
    const value = await offer();
    expect(value.product.canonicalQuantity).toBe(1000);
    for (const product of [{ ...value.product, canonicalQuantity: 500 }, { ...value.product, unitPrice: { ...value.product.unitPrice, paise: 1 } }, { ...value.product, packageCount: 2 }, { ...value.product, price: 69.5 }]) expect(offerSchema.safeParse({ ...value, product }).success).toBe(false);
  });
  it("rejects unsafe product links and extra response fields", async () => {
    const value = await offer();
    expect(offerSchema.safeParse({ ...value, productUrl: "http://localhost/private" }).success).toBe(false);
    expect(offerSchema.safeParse({ ...value, productUrl: "https://user:secret@example.com/item" }).success).toBe(false);
    expect(offerSchema.safeParse({ ...value, accessToken: "secret" }).success).toBe(false);
  });
  it("returns a degraded health state on provider errors", async () => {
    const provider = makeProvider("freshlane", async () => { throw new Error("private upstream diagnostic"); });
    const result = await provider.getCatalogOffers(location);
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("private upstream");
    expect((await provider.getProviderHealth()).status).toBe("DEGRADED");
  });
});

describe("basket repricing and fee integrity", () => {
  it("applies delivery exactly once for a multi-item order", async () => {
    const value = await quote();
    expect(value.itemSubtotal).toBe(13800); expect(value.finalPayable).toBe(18500);
    expect(value.charges!.filter(c => c.label === "Delivery")).toEqual([{ label: "Delivery", amount: 2500 }]);
    const basket = optimizeBasket(matchProducts(parseShoppingList("2 x 1L Amul milk"), demoCatalog("bengaluru"), "bengaluru"), retailers, { retailerIds: ["freshlane"] }).cheapest!;
    const order = applyQuote(basket.orders[0], value);
    expect(order.total).toBe(value.finalPayable); expect(order.total).not.toBe(value.finalPayable! + 2500);
  });
  it("aggregates repeated products before quoting without duplicating fees", async () => {
    const req = { ...request(), lines: [{ offerId: "freshlane-milk", packs: 1 }, { offerId: "freshlane-milk", packs: 1 }] };
    expect(quoteFingerprint(req)).toBe(quoteFingerprint(request()));
    const response = await makeProvider().getBasketQuote(req);
    expect(response.ok && response.value.lines).toHaveLength(1);
    expect(response.ok && response.value.finalPayable).toBe(18500);
  });
  it("rechecks free delivery and ineligible discounts after quantity changes", async () => {
    const provider = makeProvider();
    const small = await provider.getBasketQuote(request(7)), large = await provider.getBasketQuote(request(8));
    expect(small.ok && small.value.charges!.find(c => c.label === "Delivery")!.amount).toBe(2500);
    expect(large.ok && large.value.charges!.find(c => c.label === "Delivery")!.amount).toBe(0);
    const pantry = await makeProvider("pantry").getBasketQuote({ ...request(), lines: [{ offerId: "pantry-rice", packs: 1 }] });
    expect(pantry.ok && pantry.value.discount).toBe(0);
  });
  it("rejects a quote when quantity, location, allocation or conditions change", async () => {
    const value = await quote();
    const changed = [request(3), { ...request(), location: demoLocation("pune") }, { ...request(), lines: [{ offerId: "freshlane-milk-alt", packs: 2 }] }, { ...request(), conditionsKey: "member" }];
    for (const req of changed) expect(validateQuote(value, req, "freshlane", "SIMULATED_AUTHORIZED", now).ok).toBe(false);
    expect(validateQuote(value, request(), "daily", "SIMULATED_AUTHORIZED", now).ok).toBe(false);
  });
  it("rejects expired quotes at the exact expiry boundary", async () => {
    const value = await quote();
    expect(validateQuote(value, request(), "freshlane", "SIMULATED_AUTHORIZED", Date.parse(value.expiresAt))).toMatchObject({ ok: false, error: { code: "EXPIRED" } });
  });
  it("does not manufacture zero fees for an incomplete quote", async () => {
    const provider = makeProvider("freshlane", simulatedTransport("freshlane", "missing-fees", () => now));
    const value = await provider.getBasketQuote(request());
    expect(value).toMatchObject({ ok: true, value: { status: "INCOMPLETE", charges: null, finalPayable: null } });
    expect(value.ok && validateQuote(value.value, request(), "freshlane", "SIMULATED_AUTHORIZED", now)).toMatchObject({ ok: false, error: { code: "MISSING_FEES" } });
  });
  it("rejects duplicate fees, unknown tax, ineligible discounts and irreconcilable totals", async () => {
    const value = await quote();
    for (const invalid of [{ ...value, charges: [...value.charges!, value.charges![0]] }, { ...value, tax: "UNKNOWN" }, { ...value, discountEligible: false, discount: 100 }, { ...value, finalPayable: value.finalPayable! + 2500 }, { ...value, lines: [...value.lines, value.lines[0]] }]) expect(basketQuoteSchema.safeParse(invalid).success).toBe(false);
    expect(basketQuoteSchema.safeParse({ ...value, amountMode: "COMPONENTS_EXCLUSIVE" }).success).toBe(true);
  });
  it("never quotes an out-of-stock item or a below-minimum order", async () => {
    expect((await makeProvider("daily").getBasketQuote({ ...request(), location: demoLocation("pune"), lines: [{ offerId: "daily-eggs", packs: 1 }] })).ok).toBe(false);
    expect((await makeProvider("pantry").getBasketQuote({ ...request(), lines: [{ offerId: "pantry-milk", packs: 1 }] })).ok).toBe(false);
  });
});

describe("savings evidence", () => {
  const valid: SavingsEvidence = { total: 10_000, complete: true, current: true, requestKey: "same-request", locationKey: locationKey(location), conditionsKey: "public-demo", productSignature: "same-products-and-quantities", sourceTypes: ["SIMULATED_AUTHORIZED"], context: "BASKET_ESTIMATE" };
  it("labels comparable demo savings as estimated", () => expect(comparableSavings(valid, { ...valid, total: 12_000 })).toEqual({ amount: 2000, estimated: true }));
  it("requires a valid complete comparable reference", () => {
    expect(comparableSavings(valid, null)).toBeNull();
    for (const changed of [{ complete: false }, { current: false }, { requestKey: "different-quantity" }, { locationKey: "different-area" }, { conditionsKey: "membership" }, { productSignature: "different-quality" }, { context: "CHECKOUT_QUOTE" as const }]) expect(comparableSavings(valid, { ...valid, ...changed })).toBeNull();
  });
  it("refuses mixed demo/live comparisons and mixed baskets", () => {
    expect(comparableSavings(valid, { ...valid, sourceTypes: ["AUTHORIZED_API"] })).toBeNull();
    expect(comparableSavings({ ...valid, sourceTypes: ["AUTHORIZED_API", "DEMO"] }, valid)).toBeNull();
  });
});
