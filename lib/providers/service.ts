import { comparisonSchema, productSchema, type Basket, type ComparisonInput, type ComparisonResponse, type Retailer } from "../domain";
import { retailers } from "../catalog";
import { matchProducts } from "../matching";
import { optimizeBasket } from "../optimizer";
import { capabilityFailure, offerSchema, serviceabilitySchema, type BasketQuote, type CommerceProvider, type DeliveryContext, type Offer, type PriceContext, type SourceType } from "./contracts";
import { assessFreshness, dataMode, demoFreshnessPolicy, isCurrent, type FreshnessPolicy } from "./freshness";
import { demoLocation, locationKey } from "./location";
import type { OfferDiagnostic, PricingDiagnostics, ProviderDiagnostic } from "./metadata";
import { applyQuote, basketSignature, comparableSavings, quoteFingerprint, requestFingerprint, validateQuote, type SavingsEvidence } from "./quotes";
import { ReferenceProvider, simulatedTransport } from "./reference";
import { providerDefinitions } from "./registry";
import { ProviderExecutor, simulationAccessPolicy } from "./reliability";

export type ProviderBinding = { provider: CommerceProvider; retailer: Retailer; sourceType: SourceType; policies: Partial<Record<PriceContext, FreshnessPolicy>> };
export type ProviderComparisonInput = Omit<ComparisonInput, "location" | "pin" | "retailerIds" | "simulation"> & { delivery: DeliveryContext; retailerIds: string[]; conditionsKey?: string };
export type ServiceOptions = { now?: () => number };

/** Provider DTO validation and repricing surround the existing pure optimizer. */
export async function compareProviders(input: ProviderComparisonInput, bindings: ProviderBinding[], options: ServiceOptions = {}): Promise<ComparisonResponse> {
  const now = options.now ?? Date.now;
  const key = locationKey(input.delivery);
  const conditions = input.conditionsKey ?? "public-demo";
  const selected = bindings.filter(b => input.retailerIds.includes(b.provider.id));
  const issues: string[] = [];
  const providerDiagnostics: ProviderDiagnostic[] = [];
  const offerDiagnostics: Record<string, OfferDiagnostic> = {};
  const offers: Offer[] = [];
  if (selected.length !== new Set(input.retailerIds).size) issues.push("One or more requested providers are not registered or enabled.");
  const batches = await Promise.all(selected.map(async binding => {
    const { provider } = binding;
    const caps = provider.getCapabilities();
    const approvalMissing = binding.sourceType === "AUTHORIZED_API" && [caps.catalogSearch, caps.locationAvailability, caps.basketQuote].some(c => c.state !== "SUPPORTED_AUTHORIZED" || c.scope !== "APPROVED_PROVIDER");
    const unavailable = capabilityFailure(caps.catalogSearch) ?? capabilityFailure(caps.locationAvailability) ?? (approvalMissing ? { ok: false as const, error: { code: "APPROVAL_REQUIRED" as const, message: "Approval required", retryable: false } } : null);
    const service = unavailable ?? await provider.getLocationAvailability(input.delivery).catch(() => ({ ok: false as const, error: { code: "UNAVAILABLE" as const, message: "Unavailable", retryable: true } }));
    const parsed = service.ok ? serviceabilitySchema.safeParse(service.value) : null;
    const validService = parsed?.success && parsed.data.providerId === provider.id && parsed.data.locationKey === key ? parsed.data : null;
    const catalog = validService?.status === "available" ? await provider.getCatalogOffers(input.delivery).catch(() => ({ ok: false as const, error: { code: "UNAVAILABLE" as const, message: "Unavailable", retryable: true } })) : null;
    let issue: string | null = !validService || validService.status !== "available" ? `${binding.retailer.name}: coverage is ${validService?.status ?? "unknown"}.` : !catalog?.ok ? `${binding.retailer.name}: ${catalog && !catalog.ok ? catalog.error.code : "UNAVAILABLE"}. Refresh to retry.` : !catalog.value.complete || catalog.value.warnings.length > 0 ? `${binding.retailer.name}: incomplete catalog response.` : null;
    const normalized: Offer[] = [];
    if (catalog?.ok) for (const raw of catalog.value.offers) {
      const parsedOffer = offerSchema.safeParse(raw);
      if (!parsedOffer.success || parsedOffer.data.product.retailerId !== provider.id || parsedOffer.data.sourceType !== binding.sourceType || parsedOffer.data.locationKey !== key || locationKey(parsedOffer.data.location) !== key || Date.parse(parsedOffer.data.collectedAt) > now() || parsedOffer.data.conditionsKey !== conditions || (binding.sourceType === "AUTHORIZED_API" && parsedOffer.data.restrictions.length > 0)) {
        issue = `${binding.retailer.name}: invalid or unsupported offer conditions.`; normalized.length = 0; break;
      }
      normalized.push(parsedOffer.data);
    }
    if (new Set(normalized.map(o => o.id)).size !== normalized.length) { normalized.length = 0; issue = `${binding.retailer.name}: duplicate offer identities.`; }
    const health = await provider.getProviderHealth().catch(() => ({ status: "DEGRADED" as const, checkedAt: new Date(now()).toISOString(), code: "UNAVAILABLE" as const }));
    return { binding, normalized, diagnostic: { id: provider.id, name: binding.retailer.name, enabled: true, serviceability: validService, capabilities: caps, health, issue } };
  }));
  for (const { binding, normalized, diagnostic } of batches) {
    providerDiagnostics.push(diagnostic); if (diagnostic.issue) issues.push(diagnostic.issue);
    for (const offer of normalized) {
      const freshness = assessFreshness(offer, binding.policies[offer.context], now());
      offerDiagnostics[offer.id] = { sourceId: offer.sourceId, sourceType: offer.sourceType, context: offer.context, freshness, verification: offer.sourceType === "AUTHORIZED_API" && offer.verifiedAt ? "PROVIDER_VERIFIED" : "UNAVAILABLE" };
      offers.push(offer);
      if (!isCurrent(freshness) && !issues.includes("Some offers are stale, expired or unverified. Refresh before comparing current estimates.")) issues.push("Some offers are stale, expired or unverified. Refresh before comparing current estimates.");
    }
  }
  const products = offers.filter(o => isCurrent(offerDiagnostics[o.id].freshness) && o.eligible && !o.membership && o.tax === "INCLUDED" && ["LOCATION_PRICE", "CATALOG_PRICE"].includes(o.context)).map(o => productSchema.parse({ ...o.product, available: o.stock === "IN_STOCK" && o.availabilityConfidence !== "UNKNOWN", location: key, updatedAt: o.collectedAt, source: o.sourceType === "AUTHORIZED_API" ? "normalized-authorized-provider" : "fictional-demo-fixture" }));
  const stores = selected.map(b => b.retailer);
  const matches = matchProducts(input.items, products, key);
  let result = optimizeBasket(matches, stores, input);
  const quoteMemo = new Map<string, Promise<BasketQuote | null>>();
  const quotes: BasketQuote[] = [];
  let repricedChanged = false;
  async function reprice(basket: Basket | null): Promise<Basket | null> {
    if (!basket) return null;
    const orders = [];
    for (const order of basket.orders) {
      const binding = selected.find(b => b.provider.id === order.retailer.id)!;
      const request = { location: input.delivery, conditionsKey: conditions, lines: order.lines.map(l => ({ offerId: l.product.id, packs: l.packs })) };
      const cacheKey = `${binding.provider.id}:${quoteFingerprint(request)}`;
      if (!quoteMemo.has(cacheKey)) quoteMemo.set(cacheKey, (async () => {
        const blocked = capabilityFailure(binding.provider.getCapabilities().basketQuote);
        const response = blocked ?? await binding.provider.getBasketQuote(request).catch(() => ({ ok: false as const, error: { code: "UNAVAILABLE" as const, message: "Unavailable", retryable: false } }));
        const checked = response.ok ? validateQuote(response.value, request, binding.provider.id, binding.sourceType, now()) : response;
        if (!checked.ok) { issues.push(`${order.retailer.name}: basket quote ${checked.error.code}. No complete payable amount is claimed.`); return null; }
        quotes.push(checked.value); return checked.value;
      })());
      const quote = await quoteMemo.get(cacheKey)!;
      if (!quote) return null;
      const repriced = applyQuote(order, quote);
      if (repriced.total !== order.total || repriced.lines.some((line, index) => line.lineTotal !== order.lines[index].lineTotal)) repricedChanged = true;
      orders.push(repriced);
    }
    return { ...basket, orders, total: orders.reduce((sum, order) => sum + order.total, 0), substitutions: orders.flatMap(o => o.lines).filter(l => l.requiresApproval) };
  }
  const cheapest = await reprice(result.cheapest), singleStore = await reprice(result.singleStore), fewerDeliveries = await reprice(result.fewerDeliveries);
  if (quotes.some(q => Date.parse(q.expiresAt) <= now())) issues.push("A basket quote expired during repricing. Refresh to retry.");
  const current = offers.length > 0 && offers.every(o => isCurrent(assessFreshness(o, selected.find(b => b.provider.id === o.product.retailerId)?.policies[o.context], now()))) && quotes.every(q => Date.parse(q.expiresAt) > now());
  const complete = issues.length === 0;
  const context = quotes.length > 0 && quotes.every(q => q.context === "CHECKOUT_QUOTE") ? "CHECKOUT_QUOTE" : "BASKET_ESTIMATE";
  const evidence = (basket: Basket): SavingsEvidence => ({ total: basket.total, complete, current, requestKey: requestFingerprint(input.items), locationKey: key, conditionsKey: conditions, productSignature: basketSignature(basket), sourceTypes: basket.orders.flatMap(o => o.lines.map(l => offers.find(offer => offer.id === l.product.id)!.sourceType)), context });
  const comparableStrategies = singleStore && [cheapest, fewerDeliveries].every(b => !b || comparableSavings(evidence(b), evidence(singleStore)) !== null);
  const savings = cheapest && comparableStrategies ? comparableSavings(evidence(cheapest), singleStore ? evidence(singleStore) : null) : null;
  // Different provider totals invalidate the model's final-price optimality claim.
  result = { ...result, cheapest, singleStore, fewerDeliveries, reference: savings && singleStore ? { label: `${repricedChanged ? "Repriced single-store candidate" : result.reference?.label ?? "Complete comparable single-store basket"} · estimate`, total: singleStore.total } : null, savings: savings?.amount ?? null,
    status: repricedChanged || (!complete && cheapest) ? "bounded" : result.status,
    explanation: !complete ? `Incomplete comparison. ${issues.join(" ")} ${cheapest ? "Only a fully quoted basket from available data is shown; it is not a proven overall minimum." : "No complete current payable basket is shown."}` : repricedChanged ? "Provider repricing changed the model totals. These are repriced candidates only; the final-price optimum has not been proven." : result.explanation };
  const statuses = Object.values(offerDiagnostics).map(o => o.freshness.status);
  const freshness = (["EXPIRED", "STALE", "UNKNOWN", "AGING", "FRESH"] as const).find(status => statuses.includes(status)) ?? "UNKNOWN";
  const expiries = [...Object.values(offerDiagnostics).map(o => o.freshness.expiresAt), ...quotes.map(q => q.expiresAt)].filter((date): date is string => date !== null);
  for (const definition of providerDefinitions.filter(p => !p.featureEnabled)) providerDiagnostics.push({ id: definition.id, name: definition.name, enabled: false, serviceability: null, capabilities: definition.capabilities, health: { status: "DISABLED", checkedAt: new Date(now()).toISOString() }, issue: "Not connected: authorization and credentials required" });
  const pricing: PricingDiagnostics = { mode: dataMode(offers.map(o => o.sourceType)), context, comparisonComplete: complete, current, freshness, generatedAt: new Date(now()).toISOString(), expiresAt: expiries.length ? new Date(Math.min(...expiries.map(Date.parse))).toISOString() : null, locationKey: key, providers: providerDiagnostics, offers: offerDiagnostics, quotes, issues: [...new Set(issues)], optimality: repricedChanged ? "REPRICED_CANDIDATES_ONLY" : result.status === "optimal" && complete ? "MODEL_PROVEN" : "MODEL_BOUNDED", estimatedSavings: savings?.estimated ?? true };
  return { matches, result, retailers: stores, pricing };
}

// Shared bounded executors impose per-provider process limits across HTTP requests.
const executors = new Map(retailers.map(r => [r.id, new ProviderExecutor(r.id, simulationAccessPolicy)]));
export async function compareDemo(raw: ComparisonInput): Promise<ComparisonResponse> {
  const input = comparisonSchema.parse(raw);
  const delivery = demoLocation(input.location, input.pin);
  const bindings = retailers.map(retailer => {
    const simulation = ["timeout", "partial", "missing-fees"].includes(input.simulation ?? "normal") && retailer.id !== "daily" ? "normal" : input.simulation ?? "normal";
    return { retailer, sourceType: "SIMULATED_AUTHORIZED" as const, policies: { LOCATION_PRICE: demoFreshnessPolicy }, provider: new ReferenceProvider(retailer.id, executors.get(retailer.id), simulatedTransport(retailer.id, simulation)) };
  });
  return compareProviders({ ...input, delivery }, bindings);
}
