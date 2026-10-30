import { randomUUID } from "node:crypto";
import { admission } from "../../../lib/beta/admission";
import { saveFeedback } from "../../../lib/beta/feedback";
import { errorResponse, privateHeaders, readJson } from "../../../lib/beta/http";
import { emitMetric } from "../../../lib/beta/telemetry";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const requestId = randomUUID(), started = performance.now();
  const ticket = await admission().acquire("feedback");
  let response: Response;
  if (!ticket.allowed) response = Response.json({ error: "Feedback is busy or unavailable. Please retry later." }, { status: ticket.status, headers: { ...privateHeaders, "Retry-After": String(ticket.retryAfter) } });
  else {
    try { response = Response.json(await saveFeedback(await readJson(request, 8192)), { status: 201, headers: privateHeaders }); }
    catch (error) { response = errorResponse(error); }
    finally { await ticket.release(); }
  }
  response.headers.set("X-Request-ID", requestId);
  emitMetric({ kind: "request", operation: "feedback", requestId, status: response.status, durationMs: Math.round(performance.now() - started) });
  return response;
}
