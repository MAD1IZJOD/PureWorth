import { z } from "zod";

export const usageEvents = ["session_started", "list_submitted", "results_viewed", "strategy_changed", "plan_downloaded", "comparison_failed", "visible_error", "feedback_submitted"] as const;
const eventSchema = z.object({
  kind: z.enum(["request", "optimization", "usage"]),
  operation: z.enum(["compare", "feedback", "analytics", "readiness"]),
  requestId: z.uuid().optional(), status: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  explored: z.number().int().min(0).max(200_000).optional(), bounded: z.boolean().optional(),
  providerFailures: z.number().int().min(0).max(10).optional(),
  quoteFailures: z.number().int().min(0).max(10).optional(),
  event: z.enum(usageEvents).optional(),
}).strict();

/** Only bounded categories/numbers pass. No bodies, headers, IPs, PINs or errors. */
export function emitMetric(event: unknown, sink: (line: string) => void = line => console.info(line)): void {
  try {
    const checked = eventSchema.safeParse(event);
    if (checked.success) sink(JSON.stringify({ service: "pureworth", version: 1, ...checked.data }));
  } catch { /* Observability must never break a shopping request. */ }
}
