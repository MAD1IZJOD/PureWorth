import type { BetaConfig } from "./config";

/** REST transport is restricted to the validated server-configured Upstash origin. */
export class RedisStore {
  constructor(private readonly credentials: NonNullable<BetaConfig["redis"]>, private readonly send: typeof fetch = fetch) {}
  async command(args: (string | number)[]): Promise<unknown> {
    const response = await this.send(this.credentials.url, {
      method: "POST", headers: { Authorization: `Bearer ${this.credentials.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(800),
    });
    if (!response.ok || !response.body) throw new Error("Shared storage unavailable");
    const reader = response.body.getReader(); let size = 0, text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 32_768) { await reader.cancel(); throw new Error("Shared storage response too large"); }
        text += decoder.decode(part.value, { stream: true });
      }
      const raw: unknown = JSON.parse(text + decoder.decode());
      if (!raw || typeof raw !== "object" || !("result" in raw) || "error" in raw) throw new Error("Invalid shared storage response");
      return raw.result;
    } finally { reader.releaseLock(); }
  }
  async healthy() { try { return await this.command(["PING"]) === "PONG"; } catch { return false; } }
}

// Redis TIME avoids clock disagreements between serverless instances. Admission,
// sustained-rate tokens and expiring concurrency leases change atomically.
export const admissionScript = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local burst, refill, concurrency = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local tokens = math.min(burst, tonumber(state[1]) or burst)
local updated = tonumber(state[2]) or now
tokens = math.min(burst, tokens + math.max(0, now - updated) * refill / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if tokens < 1 then return {0, math.max(1, math.ceil((1-tokens)/refill)), 0} end
if redis.call('ZCARD', KEYS[2]) >= concurrency then return {0, 1, 0} end
redis.call('HSET', KEYS[1], 'tokens', tokens - 1, 'updated', now)
redis.call('EXPIRE', KEYS[1], 600)
redis.call('ZADD', KEYS[2], now + 20000, ARGV[4])
redis.call('EXPIRE', KEYS[2], 30)
return {1, 0, math.floor(tokens - 1)}
`;

// A bounded, private beta inbox. No public feedback-read endpoint exists.
export const feedbackScript = `
if redis.call('SET', KEYS[2], '1', 'NX', 'EX', 600) == false then return 0 end
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, 499)
redis.call('EXPIRE', KEYS[1], 2592000)
return 1
`;
