import { betaConfig } from "../../../lib/beta/config";
import { admission } from "../../../lib/beta/admission";
import { privateHeaders } from "../../../lib/beta/http";
import { emitMetric } from "../../../lib/beta/telemetry";
import { RequestBudget } from "../../../lib/providers/reliability";

export const dynamic = "force-dynamic";
const budget = new RequestBudget(30, 60_000, 2);
export async function GET() {
  const ticket = budget.acquire();
  if (!ticket.allowed) return Response.json({ status: "busy" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(ticket.retryAfterSeconds) } });
  try {
    const config = betaConfig();
    const ready = await admission(config).healthy();
    const status = ready ? 200 : 503;
    emitMetric({ kind: "request", operation: "readiness", status });
    return Response.json({ status: ready ? "ready" : "unavailable", mode: "demonstration", providers: "simulated", optionalServices: config.feedback ? "configured" : "disabled" }, { status, headers: { ...privateHeaders, ...(!ready ? { "Retry-After": "5" } : {}) } });
  } catch { return Response.json({ status: "unavailable" }, { status: 503, headers: privateHeaders }); }
  finally { ticket.release(); }
}
