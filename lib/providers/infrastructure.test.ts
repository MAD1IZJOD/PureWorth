import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryPriceCache, cacheKey, demoCachePermission, noCache, type CacheDimensions } from "./cache";
import { capabilityFailure, deliveryContextSchema, failure, matchConfidence } from "./contracts";
import { assessFreshness, dataMode, demoFreshnessPolicy, isCurrent } from "./freshness";
import { demoLocation, demoServiceability, locationKey } from "./location";
import { DisabledProvider, authorizationGate, providerDefinitions } from "./registry";
import { ProviderExecutor, RequestBudget, simulationAccessPolicy, validateProviderEndpoint } from "./reliability";

const now = Date.parse("2026-10-29T10:00:00Z");
const snapshot = (age: number) => ({ collectedAt: new Date(now - age).toISOString(), verifiedAt: null, expiresAt: null, sourceType: "SIMULATED_AUTHORIZED" as const, context: "LOCATION_PRICE" as const });
const dimensions: CacheDimensions = { provider: "freshlane", product: "milk", location: locationKey(demoLocation("bengaluru")), context: "LOCATION_PRICE", currency: "INR", conditions: "public-demo" };

describe("location, authorization and matching confidence", () => {
  it.each(["12345", "012345", "1234567", "ABCDEF", "560 01"])("rejects invalid PIN %s", pin => expect(() => demoLocation("bengaluru", pin)).toThrow());
  it("requires a location context without collecting an address", () => {
    expect(deliveryContextSchema.safeParse({ country: "IN", pin: null, areaId: null, demoArea: null }).success).toBe(false);
    expect(deliveryContextSchema.safeParse({ ...demoLocation("pune"), streetAddress: "private" }).success).toBe(false);
  });
  it("distinguishes illustrative coverage, mismatched area and valid unknown PIN", () => {
    expect(demoServiceability("daily", demoLocation("pune", "411001")).status).toBe("available");
    expect(demoServiceability("daily", demoLocation("pune", "560001")).status).toBe("unavailable");
    const uncertain = demoServiceability("daily", demoLocation("pune", "999999"));
    expect(uncertain.status).toBe("uncertain"); expect(uncertain.itemEligibilityConfirmed).toBe(false);
    expect(demoServiceability("daily", { country: "IN", pin: "560001", areaId: null, demoArea: null }).status).toBe("unknown");
  });
  it("isolates PINs and areas in location keys", () => {
    expect(locationKey(demoLocation("pune"))).not.toBe(locationKey(demoLocation("bengaluru")));
    expect(locationKey(demoLocation("pune"))).not.toBe(locationKey(demoLocation("pune", "411001")));
  });
  it("does not turn a feature flag into authorization", () => {
    expect(authorizationGate({ enabled: true, implemented: true, serverCredentialsPresent: false })).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
    expect(authorizationGate({ enabled: true, implemented: true, approvalEvidence: "test approval", serverCredentialsPresent: false })).toMatchObject({ ok: false, error: { code: "CREDENTIALS_REQUIRED" } });
    expect(authorizationGate({ enabled: true, implemented: false, approvalEvidence: "test approval", serverCredentialsPresent: true }).ok).toBe(false);
  });
  it("keeps every real provider disabled with no fabricated offer", async () => {
    for (const definition of providerDefinitions.filter(p => p.sourceType === "AUTHORIZED_API")) {
      expect(definition.featureEnabled).toBe(false);
      const provider = new DisabledProvider(definition.id);
      expect((await provider.getCatalogOffers()).ok).toBe(false);
      expect((await provider.getBasketQuote()).ok).toBe(false);
      expect((await provider.getProviderHealth()).status).toBe("DISABLED");
    }
  });
  it("distinguishes missing credentials, commercial approval and temporary outage", () => {
    for (const [state, code] of [["REQUIRES_CREDENTIALS", "CREDENTIALS_REQUIRED"], ["REQUIRES_COMMERCIAL_APPROVAL", "APPROVAL_REQUIRED"], ["TEMPORARILY_UNAVAILABLE", "UNAVAILABLE"], ["UNSUPPORTED", "UNSUPPORTED"]] as const) expect(capabilityFailure({ state, reason: "test" })).toMatchObject({ ok: false, error: { code } });
  });
  it("reports matching confidence without approving alternatives", () => {
    expect(["exact", "equivalent", "similar", "rejected"].map(c => matchConfidence(c as Parameters<typeof matchConfidence>[0]))).toEqual(["EXACT", "STRONG_EQUIVALENT", "POSSIBLE_ALTERNATIVE", "INCOMPATIBLE"]);
  });
});

describe("freshness boundaries", () => {
  it.each([[0, "FRESH"], [59_999, "FRESH"], [60_000, "AGING"], [120_000, "STALE"], [300_000, "EXPIRED"]] as const)("classifies snapshot age %i", (age, status) => expect(assessFreshness(snapshot(age), demoFreshnessPolicy, now).status).toBe(status));
  it("honors source expiry before policy expiry", () => expect(assessFreshness({ ...snapshot(0), expiresAt: new Date(now).toISOString() }, demoFreshnessPolicy, now).status).toBe("EXPIRED"));
  it("does not invent live verification or policy", () => {
    expect(assessFreshness({ ...snapshot(0), sourceType: "AUTHORIZED_API" }, demoFreshnessPolicy, now).status).toBe("UNKNOWN");
    expect(assessFreshness(snapshot(0), undefined, now).status).toBe("UNKNOWN");
    expect(assessFreshness(snapshot(-1), demoFreshnessPolicy, now).status).toBe("UNKNOWN");
    expect(isCurrent(assessFreshness(snapshot(150_000), demoFreshnessPolicy, now))).toBe(false);
  });
  it("never gives a live badge to simulated responses", () => {
    expect(dataMode(["DEMO", "SIMULATED_AUTHORIZED"])).toBe("DEMO DATA");
    expect(dataMode(["AUTHORIZED_API"])).toBe("LIVE DATA");
    expect(dataMode(["DEMO", "AUTHORIZED_API"])).toBe("PARTIAL LIVE DATA");
    expect(dataMode([])).toBe("DEMO DATA");
  });
});

describe("permission-bounded cache", () => {
  it("isolates every price dimension and returns defensive copies", () => {
    const cache = new MemoryPriceCache<{ price: number }>(10, () => now);
    expect(cache.set(dimensions, { price: 100 }, 1000, demoCachePermission)).toBe(true);
    cache.get(dimensions)!.price = 900;
    expect(cache.get(dimensions)!.price).toBe(100);
    for (const changed of [{ provider: "daily" }, { product: "rice" }, { location: "another-area" }, { context: "CATALOG_PRICE" as const }, { conditions: "member" }]) expect(cache.get({ ...dimensions, ...changed })).toBeUndefined();
    expect(cacheKey({ ...dimensions, product: "a|b" })).not.toBe(cacheKey({ ...dimensions, product: "a", location: "b|" }));
  });
  it("expires at permission and source limits without extending on reads", () => {
    let clock = now; const cache = new MemoryPriceCache<number>(2, () => clock);
    cache.set(dimensions, 1, 100_000, demoCachePermission, now + 500);
    clock += 499; expect(cache.get(dimensions)).toBe(1);
    clock++; expect(cache.get(dimensions)).toBeUndefined();
    cache.set(dimensions, 2, 100_000, demoCachePermission);
    clock += 30_000; expect(cache.get(dimensions)).toBeUndefined();
  });
  it("rejects absent permission, credentials and expired data", () => {
    const cache = new MemoryPriceCache(2, () => now);
    expect(cache.set(dimensions, {}, 1000, noCache)).toBe(false);
    expect(cache.set(dimensions, { accessToken: "never-store" }, 1000, demoCachePermission)).toBe(false);
    expect(cache.set(dimensions, {}, 1000, demoCachePermission, now)).toBe(false);
  });
  it("evicts bounded LRU entries and explicitly invalidates a location", () => {
    const cache = new MemoryPriceCache<number>(2, () => now);
    cache.set(dimensions, 1, 1000, demoCachePermission);
    cache.set({ ...dimensions, product: "rice" }, 2, 1000, demoCachePermission);
    cache.get(dimensions);
    cache.set({ ...dimensions, product: "dal" }, 3, 1000, demoCachePermission);
    expect(cache.get({ ...dimensions, product: "rice" })).toBeUndefined();
    expect(cache.invalidate({ location: dimensions.location })).toBe(2);
    expect(cache.get(dimensions)).toBeUndefined();
  });
});

describe("reliable and safe provider access", () => {
  it("validates upstream responses and redacts exceptions", async () => {
    const logs: unknown[] = [];
    const executor = new ProviderExecutor("demo", { ...simulationAccessPolicy, retries: 0 }, () => now, undefined, event => logs.push(event));
    expect(await executor.run("catalog", async () => ({ ok: true, value: { price: 1.5 } }), z.object({ price: z.number().int() }))).toMatchObject({ ok: false, error: { code: "INVALID_RESPONSE" } });
    const result = await executor.run("catalog", async () => { throw new Error("Authorization: secret-test-token"); }, z.number());
    expect(JSON.stringify([logs, result])).not.toContain("secret-test-token");
  });
  it("times out abort-aware transport and bounds retries", async () => {
    let attempts = 0;
    const executor = new ProviderExecutor("demo", { ...simulationAccessPolicy, timeoutMs: 5, backoffMs: 1 });
    const result = await executor.run("catalog", signal => new Promise(resolve => { attempts++; signal.addEventListener("abort", () => resolve(failure("TIMEOUT", true)), { once: true }); }), z.number());
    expect(result).toMatchObject({ ok: false, error: { code: "TIMEOUT" } }); expect(attempts).toBe(2);
  });
  it("never retries authentication failures or exceeds Retry-After", async () => {
    let attempts = 0; const delays: number[] = [];
    const executor = new ProviderExecutor("demo", simulationAccessPolicy, () => now, async ms => { delays.push(ms); });
    await executor.run("catalog", async () => { attempts++; return failure("AUTHENTICATION", true); }, z.number());
    expect(attempts).toBe(1);
    await executor.run("catalog", async () => { attempts++; return failure("RATE_LIMITED", true, 1000); }, z.number());
    expect(attempts).toBe(2); expect(delays).toEqual([]);
  });
  it("uses bounded exponential backoff for retryable failures", async () => {
    const delays: number[] = []; let attempts = 0;
    const executor = new ProviderExecutor("demo", { ...simulationAccessPolicy, retries: 2 }, () => now, async ms => { delays.push(ms); });
    const result = await executor.run("catalog", async () => ++attempts < 3 ? failure("UNAVAILABLE", true) : { ok: true, value: 42 }, z.number());
    expect(result).toEqual({ ok: true, value: 42 }); expect(delays).toEqual([10, 20]);
  });
  it("enforces provider rate windows", async () => {
    let clock = now;
    const executor = new ProviderExecutor("demo", { ...simulationAccessPolicy, requestsPerWindow: 1 }, () => clock);
    expect((await executor.run("catalog", async () => ({ ok: true, value: 1 }), z.number())).ok).toBe(true);
    expect(await executor.run("catalog", async () => ({ ok: true, value: 1 }), z.number())).toMatchObject({ ok: false, error: { code: "RATE_LIMITED", retryAfterMs: 1000 } });
    clock += 1000; expect((await executor.run("catalog", async () => ({ ok: true, value: 1 }), z.number())).ok).toBe(true);
  });
  it("does not release timed-out non-cooperative work into unlimited concurrency", async () => {
    const executor = new ProviderExecutor("demo", { ...simulationAccessPolicy, timeoutMs: 5, retries: 0, concurrency: 1 });
    let finish!: (value: { ok: true; value: number }) => void;
    expect(await executor.run("catalog", () => new Promise(resolve => { finish = resolve; }), z.number())).toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
    expect(await executor.run("catalog", async () => ({ ok: true, value: 2 }), z.number())).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
    finish({ ok: true, value: 1 });
  });
  it("bounds request concurrency and rate with idempotent release", () => {
    let clock = now; const budget = new RequestBudget(2, 1000, 1, () => clock);
    const first = budget.acquire(); expect(first.allowed).toBe(true); expect(budget.acquire().allowed).toBe(false);
    if (first.allowed) { first.release(); first.release(); }
    expect(budget.acquire().allowed).toBe(true); expect(budget.acquire().allowed).toBe(false);
    clock += 1000; expect(budget.acquire().allowed).toBe(false); // second ticket still owns concurrency
  });
  it("rejects arbitrary URLs, IP targets, credentials and non-HTTPS endpoints", () => {
    for (const endpoint of ["http://api.example.com/approved", "https://127.0.0.1/x", "https://localhost/x", "https://api.internal/x", "https://user:secret@api.example.com/x", "https://api.example.com/x?url=http://localhost"]) expect(() => validateProviderEndpoint(endpoint, [endpoint])).toThrow();
    expect(() => validateProviderEndpoint("https://api.example.com/other", ["https://api.example.com/approved"])).toThrow();
    expect(validateProviderEndpoint("https://api.example.com/approved", ["https://api.example.com/approved"]).pathname).toBe("/approved");
  });
});
