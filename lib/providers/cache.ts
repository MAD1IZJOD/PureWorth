import type { PriceContext } from "./contracts";

export type CacheDimensions = { provider: string; product: string; location: string; context: PriceContext; currency: "INR"; conditions: string };
export type CachePermission = { allowed: boolean; maxAgeMs: number; evidence: string };
export interface PriceCache<T> {
  get(dimensions: CacheDimensions): T | undefined;
  set(dimensions: CacheDimensions, value: T, requestedTtlMs: number, permission: CachePermission, sourceExpiresAt?: number): boolean;
  invalidate(filter: Partial<CacheDimensions>): number;
  clear(): void;
}
export const noCache: CachePermission = { allowed: false, maxAgeMs: 0, evidence: "No provider retention agreement configured" };
export const demoCachePermission: CachePermission = { allowed: true, maxAgeMs: 30_000, evidence: "Local fictional fixtures only; illustrative policy" };
export function cacheKey(d: CacheDimensions): string {
  return JSON.stringify([d.provider, d.product, d.location, d.context, d.currency, d.conditions]);
}

/** Bounded process-local LRU. Values are validated, public price DTOs only, never credentials. */
export class MemoryPriceCache<T> implements PriceCache<T> {
  private entries = new Map<string, { dimensions: CacheDimensions; value: T; expires: number }>();
  constructor(private readonly capacity = 200, private readonly now: () => number = Date.now) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) throw new Error("Invalid cache capacity");
  }
  get(d: CacheDimensions): T | undefined {
    const key = cacheKey(d), entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }
  set(d: CacheDimensions, value: T, ttl: number, permission: CachePermission, sourceExpiresAt = Infinity): boolean {
    this.entries.delete(cacheKey(d));
    if (!permission.allowed || !permission.evidence || !Number.isSafeInteger(ttl) || !Number.isSafeInteger(permission.maxAgeMs) || ttl <= 0 || permission.maxAgeMs <= 0 || Number.isNaN(sourceExpiresAt)) return false;
    const expires = Math.min(this.now() + ttl, this.now() + permission.maxAgeMs, sourceExpiresAt);
    if (expires <= this.now()) return false;
    // Reject credential-like fields defensively; adapters must pass only normalized public DTOs.
    const serialized = JSON.stringify(value);
    if (serialized.length > 1_000_000 || /"(?:password|authorization|accessToken|refreshToken|apiKey|secret|cookie|credentials)"\s*:/i.test(serialized)) return false;
    for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(key);
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(cacheKey(d), { dimensions: { ...d }, value: structuredClone(value), expires });
    return true;
  }
  invalidate(filter: Partial<CacheDimensions>): number {
    let removed = 0;
    for (const [key, entry] of this.entries) if (Object.entries(filter).every(([name, value]) => entry.dimensions[name as keyof CacheDimensions] === value)) { this.entries.delete(key); removed++; }
    return removed;
  }
  clear(): void { this.entries.clear(); }
}
