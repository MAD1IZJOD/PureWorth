import { randomUUID } from "node:crypto";
import { comparisonSchema } from "../../../lib/domain";
import { compareDemo } from "../../../lib/providers/service";
import { admission } from "../../../lib/beta/admission";
import { errorResponse, HttpError, privateHeaders, readJson } from "../../../lib/beta/http";
import { emitMetric } from "../../../lib/beta/telemetry";
import { RequestBudget } from "../../../lib/providers/reliability";

export const runtime = "nodejs";
// Keep admitted work below the reference providers' own burst quota as well.
// This is an additional process guard, never a replacement for shared admission.
const coreBudget = new RequestBudget(12, 1000, 4);

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID(), started = performance.now();
  let response: Response;
  const ticket = await admission().acquire("compare");
  if (!ticket.allowed) response = Response.json({ error: ticket.status === 429 ? "Comparison is busy. Your list is still here; retry shortly." : "Comparison protection is unavailable. Please retry later." }, { status: ticket.status, headers: { ...privateHeaders, "Retry-After": String(ticket.retryAfter) } });
  else {
    try {
      const input = comparisonSchema.safeParse(await readJson(request));
      if (!input.success) throw new HttpError(400, `Review your list and preferences: ${input.error.issues[0]?.message ?? "invalid input"}`);
      const coreTicket = coreBudget.acquire();
      if (!coreTicket.allowed) {
        response = Response.json({ error: "Comparison is busy. Your list is still here; retry shortly." }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(coreTicket.retryAfterSeconds) } });
      } else {
      try {
      const coreStarted = performance.now();
      const data = await compareDemo(input.data);
      emitMetric({ kind: "optimization", operation: "compare", requestId, durationMs: Math.round(performance.now() - coreStarted), explored: data.result.explored, bounded: data.result.status === "bounded", providerFailures: data.pricing?.providers.filter(p => p.enabled && p.issue).length ?? 0, quoteFailures: data.pricing?.issues.filter(issue => issue.includes("basket quote")).length ?? 0 });
      response = Response.json(data, { headers: privateHeaders });
      } finally { coreTicket.release(); }
      }
    } catch (error) { response = error instanceof HttpError ? errorResponse(error) : Response.json({ error: "Comparison is temporarily unavailable. Your list is still here; please try again." }, { status: 500, headers: privateHeaders }); }
    finally { await ticket.release(); }
  }
  const durationMs = Math.round(performance.now() - started);
  response.headers.set("X-Request-ID", requestId);
  response.headers.set("Server-Timing", `request;dur=${durationMs}`);
  emitMetric({ kind: "request", operation: "compare", requestId, status: response.status, durationMs });
  return response;
}
