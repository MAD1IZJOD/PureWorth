import type { Offer, PriceContext, SourceType } from "./contracts";

export type FreshnessStatus = "FRESH" | "AGING" | "STALE" | "EXPIRED" | "UNKNOWN";
export type FreshnessPolicy = { freshMs: number; agingMs: number; expireMs: number; evidence: string };
export type Freshness = { status: FreshnessStatus; ageMs: number | null; expiresAt: string | null; estimated: boolean; reason: string };
export type FreshnessPolicies = Partial<Record<string, Partial<Record<PriceContext, FreshnessPolicy>>>>;

/** Illustrative local simulation policy; these are not retailer freshness guarantees. */
export const demoFreshnessPolicy: FreshnessPolicy = { freshMs: 60_000, agingMs: 120_000, expireMs: 300_000, evidence: "PureWorth local simulation v1" };

export function assessFreshness(
  offer: Pick<Offer, "collectedAt" | "verifiedAt" | "expiresAt" | "sourceType" | "context">,
  policy: FreshnessPolicy | undefined, now = Date.now(),
): Freshness {
  const estimated = offer.context !== "CHECKOUT_QUOTE" || offer.sourceType !== "AUTHORIZED_API";
  const result = (status: FreshnessStatus, ageMs: number | null, expiresAt: string | null, reason: string): Freshness => ({ status, ageMs, expiresAt, estimated, reason });
  const explicitExpiry = offer.expiresAt ? Date.parse(offer.expiresAt) : null;
  if (explicitExpiry !== null && Number.isFinite(explicitExpiry) && explicitExpiry <= now) return result("EXPIRED", null, offer.expiresAt, "Source expiry reached");
  const observed = offer.verifiedAt ?? (offer.sourceType === "AUTHORIZED_API" ? null : offer.collectedAt);
  const timestamp = observed ? Date.parse(observed) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(timestamp) || timestamp > now || (explicitExpiry !== null && !Number.isFinite(explicitExpiry))) return result("UNKNOWN", null, null, "Price verification unavailable");
  const age = now - timestamp;
  if (!policy || !policy.evidence || ![policy.freshMs, policy.agingMs, policy.expireMs].every(Number.isSafeInteger) || policy.freshMs < 0 || policy.freshMs > policy.agingMs || policy.agingMs >= policy.expireMs) return result("UNKNOWN", age, offer.expiresAt, "No approved freshness policy");
  const expiry = Math.min(timestamp + policy.expireMs, explicitExpiry ?? Infinity);
  const status: FreshnessStatus = now >= expiry ? "EXPIRED" : age < policy.freshMs ? "FRESH" : age < policy.agingMs ? "AGING" : "STALE";
  return result(status, age, new Date(expiry).toISOString(), offer.sourceType === "AUTHORIZED_API" ? "Provider verification under configured policy" : "Illustrative simulation snapshot age; not a live price verification");
}

export function isCurrent(freshness: Freshness): boolean {
  return freshness.status === "FRESH" || freshness.status === "AGING";
}

export function dataMode(sources: SourceType[]): "DEMO DATA" | "LIVE DATA" | "PARTIAL LIVE DATA" {
  const live = sources.filter(s => s === "AUTHORIZED_API").length;
  return live === 0 ? "DEMO DATA" : live === sources.length ? "LIVE DATA" : "PARTIAL LIVE DATA";
}
