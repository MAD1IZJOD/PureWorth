import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RequestBudget } from "../providers/reliability";
import { betaConfig, type BetaConfig } from "./config";
import { admissionScript, RedisStore } from "./redis";

export type Operation = "compare" | "feedback" | "analytics";
type Ticket = { allowed: true; release: () => Promise<void> } | { allowed: false; status: 429 | 503; retryAfter: number };
export interface Admission { acquire(operation: Operation): Promise<Ticket>; healthy(): Promise<boolean> }
const limits = { compare: [12, 2, 8], feedback: [3, 0.1, 2], analytics: [20, 5, 4] } as const;
const replySchema = z.tuple([z.union([z.literal(0), z.literal(1)]), z.number().int().min(0).max(600), z.number().int().nonnegative()]);

/** Global shared budgets: no IP, forwarded header or browser identifier is trusted. */
export class SharedAdmission implements Admission {
  constructor(private readonly store: Pick<RedisStore, "command" | "healthy">, private readonly namespace: string) {}
  async healthy() { return this.store.healthy(); }
  async acquire(operation: Operation): Promise<Ticket> {
    const tag = `{pureworth-${this.namespace}}:${operation}`, lease = randomUUID();
    try {
      const [allowed, retryAfter] = replySchema.parse(await this.store.command(["EVAL", admissionScript, 2, `${tag}:bucket`, `${tag}:leases`, ...limits[operation], lease]));
      if (!allowed) return { allowed: false, status: 429, retryAfter: Math.max(1, retryAfter) };
      let released = false;
      return { allowed: true, release: async () => {
        if (released) return; released = true;
        try { await this.store.command(["ZREM", `${tag}:leases`, lease]); } catch { /* Lease expires after 20s; never fail the user's response. */ }
      } };
    } catch { return { allowed: false, status: 503, retryAfter: 5 }; }
  }
}

/** Local-only fixed budgets. Deployment never falls back to process memory. */
export class LocalAdmission implements Admission {
  private budgets = { compare: new RequestBudget(), feedback: new RequestBudget(5, 60_000, 2), analytics: new RequestBudget(120, 60_000, 4) };
  async healthy() { return true; }
  async acquire(operation: Operation): Promise<Ticket> {
    const ticket = this.budgets[operation].acquire();
    return ticket.allowed ? { allowed: true, release: async () => ticket.release() } : { allowed: false, status: 429, retryAfter: ticket.retryAfterSeconds };
  }
}
const local = new LocalAdmission();
export function admission(config: BetaConfig = betaConfig()): Admission {
  if (!config.deployed) return local;
  if (config.access === "protected" && config.redis) return new SharedAdmission(new RedisStore(config.redis), config.namespace);
  return { healthy: async () => false, acquire: async () => ({ allowed: false, status: 503, retryAfter: 30 }) };
}
