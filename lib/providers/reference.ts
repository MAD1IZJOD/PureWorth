import { z } from "zod";
import { demoCatalog, retailers } from "../catalog";
import type { Match } from "../domain";
import { priceOrder } from "../optimizer";
import { MemoryPriceCache, demoCachePermission, type CacheDimensions } from "./cache";
import { basketQuoteSchema, capabilityFailure, deliveryContextSchema, errorCodes, failure, offerSchema, serviceabilitySchema, type BasketQuote, type CatalogPage, type CommerceProvider, type DeliveryContext, type Offer, type ProviderHealth, type ProviderResult, type QuoteRequest, type Simulation } from "./contracts";
import { demoFreshnessPolicy } from "./freshness";
import { demoServiceability, locationKey } from "./location";
import { groupedLines, quoteFingerprint, quoteRequestSchema } from "./quotes";
import { demoCapabilities } from "./registry";
import { ProviderExecutor, simulationAccessPolicy } from "./reliability";

const catalogSchema = z.object({ offers: z.array(offerSchema).max(1000), complete: z.boolean(), warnings: z.array(z.enum(errorCodes)).max(20) }).strict();
export type ReferenceOperation = "catalog" | "details" | "serviceability" | "quote";
export type ReferenceTransport = (operation: ReferenceOperation, payload: { location: DeliveryContext; query?: string; productId?: string; quote?: QuoteRequest }, signal: AbortSignal) => Promise<ProviderResult<unknown>>;

/** Simulates an approved transport contract, NEVER a real retailer API or approval. */
export function simulatedTransport(providerId: string, simulation: Simulation = "normal", now: () => number = Date.now): ReferenceTransport {
  if (!retailers.some(r => r.id === providerId)) throw new Error("Only fictional retailers may use the simulated transport");
  return async (operation, payload, signal) => {
    if (simulation === "timeout" && operation !== "serviceability") return new Promise(resolve => {
      if (signal.aborted) return resolve(failure("TIMEOUT", true));
      signal.addEventListener("abort", () => resolve(failure("TIMEOUT", true)), { once: true });
    });
    const location = payload.location;
    const serviceability = demoServiceability(providerId, location);
    if (operation === "serviceability") return { ok: true, value: serviceability };
    if (serviceability.status !== "available" || !location.demoArea) return failure("LOCATION_UNSUPPORTED");
    const age = simulation === "stale" ? 150_000 : simulation === "expired" ? 360_000 : 0;
    const collected = now() - age;
    const offers: Offer[] = demoCatalog(location.demoArea).filter(p => p.retailerId === providerId).map(p => {
      const identity = Object.fromEntries(Object.entries(p).filter(([key]) => !["available", "location", "source", "updatedAt"].includes(key)));
      return offerSchema.parse({ id: p.id, canonicalProductId: p.retailerProductId, product: identity,
        currency: "INR", stock: p.available ? "IN_STOCK" : "OUT_OF_STOCK", availabilityConfidence: "CONFIRMED",
        location, locationKey: locationKey(location), context: "LOCATION_PRICE", sourceId: "fictional-demo-fixture@2026-10-01",
        sourceType: "SIMULATED_AUTHORIZED", collectedAt: new Date(collected).toISOString(), verifiedAt: null,
        expiresAt: new Date(collected + demoFreshnessPolicy.expireMs).toISOString(), productUrl: null, tax: "INCLUDED",
        restrictions: ["Fictional demonstration price; no retailer verification"], membership: null, eligible: true, conditionsKey: "public-demo",
      });
    });
    if (operation === "details") {
      const offer = offers.find(o => o.id === payload.productId);
      return offer ? { ok: true, value: offer } : failure("UNAVAILABLE");
    }
    if (operation === "catalog") {
      const words = (payload.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const selected = offers.filter(o => words.every(w => `${o.product.name} ${o.product.category}`.toLowerCase().includes(w)));
      return { ok: true, value: { offers: simulation === "partial" ? selected.slice(0, 7) : selected, complete: simulation !== "partial", warnings: simulation === "partial" ? ["UNAVAILABLE"] : [] } };
    }
    const request = payload.quote;
    if (!request || request.conditionsKey !== "public-demo") return failure("INVALID_INPUT");
    const lines: Match[] = [];
    for (const line of groupedLines(request)) {
      const offer = offers.find(o => o.id === line.offerId);
      if (!offer || offer.stock !== "IN_STOCK" || !offer.eligible || Date.parse(offer.expiresAt!) <= now()) return failure("UNAVAILABLE");
      lines.push({ id: line.offerId, itemId: line.offerId, product: { ...offer.product, available: true, location: location.demoArea, source: "fictional-demo-fixture", updatedAt: "2026-10-01T00:00:00.000Z" }, packs: line.packs, classification: "exact", requiresApproval: false, reason: "Simulated quote line", lineTotal: offer.product.price * line.packs });
    }
    const order = priceOrder(retailers.find(r => r.id === providerId)!, lines);
    if (!order) return failure("UNAVAILABLE");
    const incomplete = simulation === "missing-fees";
    return { ok: true, value: {
      id: `simulation-${quoteFingerprint(request)}-${now()}`, providerId, fingerprint: quoteFingerprint(request), locationKey: locationKey(location), currency: "INR", conditionsKey: request.conditionsKey,
      sourceType: "SIMULATED_AUTHORIZED", context: "BASKET_ESTIMATE", status: incomplete ? "INCOMPLETE" : "COMPLETE", amountMode: "FINAL_INCLUSIVE",
      lines: lines.map(l => ({ productId: l.product.id, packs: l.packs, unitPrice: l.product.price, total: l.lineTotal })), itemSubtotal: order.subtotal,
      charges: incomplete ? null : order.charges, discount: order.discount, discountEligible: true, tax: "INCLUDED", finalPayable: incomplete ? null : order.total,
      issuedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + demoFreshnessPolicy.expireMs).toISOString(),
    } };
  };
}

export class ReferenceProvider implements CommerceProvider {
  private readonly transport: ReferenceTransport;
  private readonly cache: MemoryPriceCache<CatalogPage>;
  private health: ProviderHealth;
  constructor(readonly id: string, private readonly executor = new ProviderExecutor(id, simulationAccessPolicy), transport?: ReferenceTransport, private readonly now: () => number = Date.now) {
    this.transport = transport ?? simulatedTransport(id);
    this.cache = new MemoryPriceCache(20, now);
    this.health = { status: "HEALTHY", checkedAt: new Date(now()).toISOString() };
  }
  getCapabilities() { return demoCapabilities(); }
  async getProviderHealth(): Promise<ProviderHealth> { return { ...this.health }; }
  invalidate(location?: DeliveryContext): void { if (location) this.cache.invalidate({ location: locationKey(location) }); else this.cache.clear(); }
  private async call<T>(operation: ReferenceOperation, payload: Parameters<ReferenceTransport>[1], schema: z.ZodType<T>): Promise<ProviderResult<T>> {
    if (!deliveryContextSchema.safeParse(payload.location).success) return failure("INVALID_INPUT");
    const capability = operation === "catalog" ? "catalogSearch" : operation === "details" ? "productDetails" : operation === "quote" ? "basketQuote" : "locationAvailability";
    const blocked = capabilityFailure(this.getCapabilities()[capability]);
    if (blocked) return blocked;
    const result = await this.executor.run(operation, signal => this.transport(operation, payload, signal), schema);
    this.health = { status: result.ok ? "HEALTHY" : "DEGRADED", checkedAt: new Date(this.now()).toISOString(), ...(result.ok ? {} : { code: result.error.code }) };
    return result;
  }
  async searchProducts(query: string, location: DeliveryContext): Promise<ProviderResult<CatalogPage>> {
    if (typeof query !== "string" || query.length > 200) return failure("INVALID_INPUT");
    const key: CacheDimensions = { provider: this.id, product: `search:${query}`, location: locationKey(location), context: "LOCATION_PRICE", currency: "INR", conditions: "public-demo" };
    const cached = this.cache.get(key);
    if (cached) return { ok: true, value: cached };
    const raw = await this.call("catalog", { query, location }, catalogSchema);
    if (!raw.ok) return raw;
    if (raw.value.offers.some(o => o.product.retailerId !== this.id || o.locationKey !== locationKey(location) || locationKey(o.location) !== locationKey(location) || o.sourceType !== "SIMULATED_AUTHORIZED" || o.conditionsKey !== "public-demo" || Date.parse(o.collectedAt) > this.now())) return failure("INVALID_RESPONSE");
    const value: CatalogPage = { ...raw.value, warnings: raw.value.warnings.map(code => { const failed = failure(code); return !failed.ok ? failed.error : { code, message: "Provider unavailable", retryable: false }; }) };
    if (value.complete) this.cache.set(key, value, 30_000, demoCachePermission, Math.min(...value.offers.map(o => Date.parse(o.expiresAt ?? ""))));
    return { ok: true, value };
  }
  getCatalogOffers(location: DeliveryContext) { return this.searchProducts("", location); }
  async getProductDetails(productId: string, location: DeliveryContext): Promise<ProviderResult<Offer>> {
    if (typeof productId !== "string" || productId.length > 200) return failure("INVALID_INPUT");
    const result = await this.call("details", { productId, location }, offerSchema);
    return result.ok && (result.value.id !== productId || result.value.product.retailerId !== this.id || result.value.sourceType !== "SIMULATED_AUTHORIZED" || result.value.locationKey !== locationKey(location)) ? failure("INVALID_RESPONSE") : result;
  }
  getLocationAvailability(location: DeliveryContext) { return this.call("serviceability", { location }, serviceabilitySchema); }
  async getBasketQuote(request: QuoteRequest): Promise<ProviderResult<BasketQuote>> {
    if (!quoteRequestSchema.safeParse(request).success) return failure("INVALID_INPUT");
    return this.call("quote", { location: request.location, quote: request }, basketQuoteSchema);
  }
}
