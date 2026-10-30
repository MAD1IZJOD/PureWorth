import { z } from "zod";
import { betaConfig } from "../../../lib/beta/config";
import { admission } from "../../../lib/beta/admission";
import { errorResponse, HttpError, privateHeaders, readJson } from "../../../lib/beta/http";
import { emitMetric, usageEvents } from "../../../lib/beta/telemetry";

const payload = z.object({ event: z.enum(usageEvents), consent: z.literal(true) }).strict();
export const runtime = "nodejs";
export async function POST(request: Request) {
  const ticket = await admission().acquire("analytics");
  if (!ticket.allowed) return Response.json({ error: "Usage reporting unavailable" }, { status: ticket.status, headers: { ...privateHeaders, "Retry-After": String(ticket.retryAfter) } });
  try {
    if (!betaConfig().analytics) throw new HttpError(404, "Usage reporting is disabled");
    const input = payload.safeParse(await readJson(request, 1024));
    if (!input.success) throw new HttpError(400, "Send a supported event with consent and no personal data");
    emitMetric({ kind: "usage", operation: "analytics", event: input.data.event });
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
  finally { await ticket.release(); }
}
