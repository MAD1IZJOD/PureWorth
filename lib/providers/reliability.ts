import { z } from "zod";
import { failure, type ProviderErrorCode, type ProviderResult } from "./contracts";

export type Diagnostic = { provider: string; operation: string; code: ProviderErrorCode; attempt: number };
export type AccessPolicy = { timeoutMs: number; retries: number; backoffMs: number; maxBackoffMs: number; concurrency: number; requestsPerWindow: number; windowMs: number };
export const simulationAccessPolicy: AccessPolicy = { timeoutMs: 150, retries: 1, backoffMs: 10, maxBackoffMs: 100, concurrency: 4, requestsPerWindow: 100, windowMs: 1000 };

/** One executor per provider, shared across requests. No unbounded work queue. */
export class ProviderExecutor {
  private active = 0;
  private starts: number[] = [];
  constructor(private readonly provider: string, private readonly policy: AccessPolicy,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    private readonly log: (event: Diagnostic) => void = () => {}) {
    if (!/^[a-z0-9-]{1,60}$/.test(provider) || Object.values(policy).some(v => !Number.isSafeInteger(v) || v < 0) || !policy.timeoutMs || !policy.concurrency || !policy.windowMs || !policy.requestsPerWindow || policy.retries > 3 || policy.maxBackoffMs > 30_000) throw new Error("Invalid provider access policy");
  }
  async run<T>(operation: string, task: (signal: AbortSignal) => Promise<ProviderResult<unknown>>, schema: z.ZodType<T>): Promise<ProviderResult<T>> {
    if (!/^[a-zA-Z]{1,40}$/.test(operation)) return failure("INVALID_INPUT");
    for (let attempt = 0; attempt <= this.policy.retries; attempt++) {
      const now = this.now();
      this.starts = this.starts.filter(t => t > now - this.policy.windowMs);
      if (this.active >= this.policy.concurrency) return failure("UNAVAILABLE", true);
      if (this.starts.length >= this.policy.requestsPerWindow) return failure("RATE_LIMITED", true, Math.max(1, this.starts[0] + this.policy.windowMs - now));
      this.starts.push(now); this.active++;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = Promise.resolve().then(() => task(controller.signal)).catch(() => failure("UNAVAILABLE", true)).finally(() => { this.active--; });
      // A non-cooperative transport retains its concurrency slot until settled.
      // An abort-aware transport must also release its own sockets/resources.
      const timeout = new Promise<ProviderResult<unknown>>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(failure("TIMEOUT", true)); }, this.policy.timeoutMs); });
      const raw = await Promise.race([work, timeout]);
      clearTimeout(timer);
      let result: ProviderResult<T>;
      if (raw.ok) {
        const parsed = schema.safeParse(raw.value);
        result = parsed.success ? { ok: true, value: parsed.data } : failure("INVALID_RESPONSE");
      } else result = failure(raw.error.code, raw.error.retryable, raw.error.retryAfterMs);
      if (result.ok) return result;
      this.log({ provider: this.provider, operation, code: result.error.code, attempt: attempt + 1 });
      const retryable = ["TIMEOUT", "RATE_LIMITED", "UNAVAILABLE"].includes(result.error.code) && result.error.retryable;
      const delay = Math.max(this.policy.backoffMs * 2 ** attempt, result.error.retryAfterMs ?? 0);
      if (!retryable || attempt === this.policy.retries || delay > this.policy.maxBackoffMs) return result;
      await this.sleep(delay);
    }
    return failure("UNAVAILABLE");
  }
}

/** Fixed endpoint declarations only. No connector currently performs outbound HTTP.
 * Future transports must additionally pin/validate resolved public IPs and reject redirects. */
export function validateProviderEndpoint(endpoint: string, allowlist: readonly string[]): URL {
  const url = new URL(endpoint);
  if (!allowlist.includes(endpoint) || url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash || url.search ||
    !/^[a-z][a-z0-9.-]*\.[a-z]{2,}$/i.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)) throw new Error("Provider endpoint is not approved");
  return url;
}

/** Process-local global abuse budget: does not trust spoofable forwarded-IP headers. */
export class RequestBudget {
  private starts: number[] = [];
  private active = 0;
  constructor(private readonly limit = 120, private readonly windowMs = 60_000, private readonly concurrency = 8, private readonly now: () => number = Date.now) {}
  acquire(): { allowed: true; release: () => void } | { allowed: false; retryAfterSeconds: number } {
    const now = this.now(); this.starts = this.starts.filter(t => t > now - this.windowMs);
    if (this.starts.length >= this.limit || this.active >= this.concurrency) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(((this.starts[0] ?? now) + this.windowMs - now) / 1000)) };
    this.starts.push(now); this.active++;
    let released = false;
    return { allowed: true, release: () => { if (!released) { this.active--; released = true; } } };
  }
}
