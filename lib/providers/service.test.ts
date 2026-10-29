import { describe, expect, it } from "vitest";
import { retailers } from "../catalog";
import { comparisonSchema, type ComparisonInput } from "../domain";
import { exampleList, parseShoppingList } from "../matching";
import type { Simulation } from "./contracts";
import { demoFreshnessPolicy } from "./freshness";
import { demoLocation } from "./location";
import { ReferenceProvider, simulatedTransport } from "./reference";
import { ProviderExecutor, simulationAccessPolicy } from "./reliability";
import { compareDemo, compareProviders, type ProviderBinding } from "./service";

const now = Date.parse("2026-10-29T10:00:00Z");
const body = (text = exampleList): ComparisonInput => comparisonSchema.parse({ items: parseShoppingList(text), location: "bengaluru", retailerIds: ["freshlane", "daily", "pantry"], maxRetailers: 3 });
function bindings(simulation: Simulation = "normal"): ProviderBinding[] {
  return retailers.map(retailer => ({ retailer, sourceType: "SIMULATED_AUTHORIZED", policies: { LOCATION_PRICE: demoFreshnessPolicy }, provider: new ReferenceProvider(retailer.id, new ProviderExecutor(retailer.id, { ...simulationAccessPolicy, timeoutMs: 5, backoffMs: 1 }, () => now), simulatedTransport(retailer.id, simulation, () => now), () => now) }));
}
function compare(input = body(), simulation: Simulation = "normal") {
  return compareProviders({ ...input, delivery: demoLocation(input.location, input.pin) }, bindings(simulation), { now: () => now });
}

describe("provider comparison service", () => {
  it("preserves the audited demo allocation and exact full totals", async () => {
    const response = await compare();
    expect(response.result.cheapest!.total).toBe(103900);
    expect(response.result.singleStore!.total).toBe(105500);
    expect(response.result.savings).toBe(1600);
    expect(response.pricing).toMatchObject({ mode: "DEMO DATA", context: "BASKET_ESTIMATE", current: true, comparisonComplete: true, optimality: "MODEL_PROVEN" });
    expect(response.pricing!.quotes.every(q => q.status === "COMPLETE")).toBe(true);
    expect(response.pricing!.providers.filter(p => !p.enabled)).toHaveLength(7);
  });
  it("routes the default API service through the actual reference adapters", async () => {
    const response = await compareDemo(body());
    expect(response.result.cheapest!.total).toBe(103900);
    expect(response.pricing!.quotes.length).toBeGreaterThan(0);
    expect(Object.values(response.pricing!.offers).every(o => o.verification === "UNAVAILABLE")).toBe(true);
  });
  it.each(["stale", "expired"] as const)("does not optimize %s offers as current prices", async simulation => {
    const response = await compare(body(), simulation);
    expect(response.result.cheapest).toBeNull(); expect(response.result.reference).toBeNull(); expect(response.result.savings).toBeNull();
    expect(response.pricing!.freshness).toBe(simulation === "stale" ? "STALE" : "EXPIRED");
    expect(response.pricing!.comparisonComplete).toBe(false);
  });
  it("returns recoverable provider timeouts with no replacement quote", async () => {
    const response = await compare(body(), "timeout");
    expect(response.result.cheapest).toBeNull(); expect(response.result.savings).toBeNull();
    expect(response.pricing!.issues.join(" ")).toContain("TIMEOUT");
    expect((await compare()).result.cheapest).not.toBeNull();
  });
  it("labels partial catalog comparisons and suppresses all savings references", async () => {
    const response = await compare(body(), "partial");
    expect(response.result.cheapest).not.toBeNull();
    expect(response.pricing!.comparisonComplete).toBe(false);
    expect(response.result.status).toBe("bounded");
    expect(response.result.reference).toBeNull(); expect(response.result.savings).toBeNull();
    expect(response.result.explanation).toContain("Incomplete comparison");
  });
  it("withholds the basket entirely when order-level fees are missing", async () => {
    const response = await compare(body(), "missing-fees");
    expect(response.result.cheapest).toBeNull(); expect(response.result.singleStore).toBeNull(); expect(response.result.fewerDeliveries).toBeNull();
    expect(response.pricing!.issues.join(" ")).toContain("MISSING_FEES");
    expect(response.result.savings).toBeNull();
  });
  it.each(["999999", "411001"])("does not infer nearby coverage for PIN %s", async pin => {
    const response = await compare({ ...body(), pin });
    expect(response.result.cheapest).toBeNull();
    expect(response.pricing!.comparisonComplete).toBe(false);
    expect(response.pricing!.providers.find(p => p.id === "daily")!.serviceability!.status).not.toBe("available");
  });
  it("reprices quantities and location without retaining the prior basket", async () => {
    const first = await compare(body("Amul milk 1L"));
    const second = await compare(body("2 x 1L Amul milk"));
    expect(first.result.cheapest!.total).not.toBe(second.result.cheapest!.total);
    expect(first.pricing!.quotes[0].fingerprint).not.toBe(second.pricing!.quotes[0].fingerprint);
    const pune = await compare({ ...body(), location: "pune", pin: "411001" });
    expect(pune.pricing!.locationKey).not.toBe(first.pricing!.locationKey);
    expect(pune.matches.flatMap(m => m.matches).some(m => m.product.id === "daily-eggs")).toBe(false);
  });
  it("retains substitution consent and matching confidence", async () => {
    const input = body("Amul milk 2L");
    const review = await compare(input);
    expect(review.result.cheapest).toBeNull();
    expect(review.matches[0].matches.every(m => m.requiresApproval)).toBe(true);
    const approved = review.matches[0].matches.find(m => m.confidence === "STRONG_EQUIVALENT")!;
    const optimized = await compare({ ...input, approved: [approved.id] });
    expect(optimized.result.cheapest).not.toBeNull();
    expect(optimized.result.cheapest!.substitutions.map(m => m.id)).toEqual([approved.id]);
  });
  it("preserves decimal and quality constraints", async () => {
    expect((await compare(body(".5L Amul milk"))).result.cheapest).toBeNull();
    const response = await compare(body("Amulya milk 1L"));
    expect(response.matches[0].matches.every(m => m.classification === "similar")).toBe(true);
    expect(response.result.cheapest).toBeNull();
  });
  it("preserves node-cap disclosure rather than claiming a proven optimum", async () => {
    const response = await compare(body(Array.from({ length: 12 }, () => "Amul milk 1L").join(",")));
    expect(response.result.status).toBe("bounded"); expect(response.result.explored).toBe(200000);
    expect(response.pricing!.optimality).toBe("MODEL_BOUNDED");
  });
  it("rejects invalid normalized offers before matching", async () => {
    const providers = bindings();
    const original = providers[0].provider.getCatalogOffers.bind(providers[0].provider);
    providers[0].provider.getCatalogOffers = async location => {
      const result = await original(location);
      if (result.ok) result.value.offers[0].product.price = 1.5;
      return result;
    };
    const response = await compareProviders({ ...body(), delivery: demoLocation("bengaluru") }, providers, { now: () => now });
    expect(response.matches.flatMap(m => m.matches).some(m => m.product.retailerId === "freshlane")).toBe(false);
    expect(response.pricing!.comparisonComplete).toBe(false); expect(response.result.savings).toBeNull();
  });
  it("does not preserve model optimality when provider repricing changes totals", async () => {
    const providers = bindings();
    for (const binding of providers) {
      const original = binding.provider.getBasketQuote.bind(binding.provider);
      binding.provider.getBasketQuote = async req => {
        const quote = await original(req);
        if (quote.ok && quote.value.finalPayable !== null && quote.value.charges) {
          quote.value.charges.push({ label: "New provider fee", amount: 500 }); quote.value.finalPayable += 500;
        }
        return quote;
      };
    }
    const response = await compareProviders({ ...body(), delivery: demoLocation("bengaluru") }, providers, { now: () => now });
    expect(response.result.status).toBe("bounded");
    expect(response.pricing!.optimality).toBe("REPRICED_CANDIDATES_ONLY");
    expect(response.result.explanation).toContain("final-price optimum has not been proven");
  });
  it("rejects unknown enabled-provider IDs without fabricated prices", async () => {
    const response = await compareProviders({ ...body(), retailerIds: ["blinkit"], delivery: demoLocation("bengaluru") }, [], { now: () => now });
    expect(response.result.cheapest).toBeNull(); expect(response.pricing!.comparisonComplete).toBe(false);
  });
  it("does not elevate simulated authorization into real-provider authorization", async () => {
    const providers = bindings().map(binding => ({ ...binding, sourceType: "AUTHORIZED_API" as const }));
    const response = await compareProviders({ ...body(), delivery: demoLocation("bengaluru") }, providers, { now: () => now });
    expect(response.matches.flatMap(group => group.matches)).toHaveLength(0);
    expect(response.result.savings).toBeNull(); expect(response.pricing!.comparisonComplete).toBe(false);
    expect(response.pricing!.mode).toBe("DEMO DATA"); // no actual live offer was received
  });
  it("rechecks earlier quotes after later provider calls consume their lifetime", async () => {
    let clock = now; const providers = bindings();
    const original = providers[2].provider.getBasketQuote.bind(providers[2].provider);
    providers[2].provider.getBasketQuote = async request => { const quote = await original(request); clock = now + 300001; return quote; };
    const response = await compareProviders({ ...body(), delivery: demoLocation("bengaluru") }, providers, { now: () => clock });
    expect(response.pricing!.current).toBe(false); expect(response.pricing!.comparisonComplete).toBe(false);
    expect(response.result.savings).toBeNull(); expect(response.result.reference).toBeNull();
  });
  it("chooses the cheapest repriced candidate when new per-order fees reverse the model ranking", async () => {
    const providers = bindings();
    for (const binding of providers) {
      const original = binding.provider.getBasketQuote.bind(binding.provider);
      binding.provider.getBasketQuote = async request => {
        const quote = await original(request);
        if (quote.ok && quote.value.finalPayable !== null && quote.value.charges) {
          quote.value.charges.push({ label: "Repriced order fee", amount: 5000 }); quote.value.finalPayable += 5000;
        }
        return quote;
      };
    }
    const response = await compareProviders({ ...body(), delivery: demoLocation("bengaluru") }, providers, { now: () => now });
    expect(response.result.cheapest!.total).toBe(110500);
    expect(response.result.cheapest!.orders).toHaveLength(1);
    expect(response.pricing!.optimality).toBe("REPRICED_CANDIDATES_ONLY");
  });
});
