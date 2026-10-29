import { comparisonSchema } from "../../../lib/domain";
import { compareDemo } from "../../../lib/providers/service";
import { RequestBudget } from "../../../lib/providers/reliability";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const budget = new RequestBudget();

export async function POST(request: Request): Promise<Response> {
  const ticket = budget.acquire();
  if (!ticket.allowed) return Response.json({ error: "Comparison is busy. Your list is still here; retry shortly." }, { status: 429, headers: { ...headers, "Retry-After": String(ticket.retryAfterSeconds) } });
  try { return await compareRequest(request); }
  finally { ticket.release(); }
}

async function compareRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  // Next.js may construct an internal localhost URL behind a proxy. Compare
  // against the incoming HTTP Host, never an untrusted forwarded-host value.
  if (origin) {
    try {
      const source = new URL(origin);
      const expectedHost = request.headers.get("host") ?? new URL(request.url).host;
      if (!["http:", "https:"].includes(source.protocol) || source.host !== expectedHost) return fail("Cross-origin requests are unavailable", 403);
    } catch { return fail("Invalid request origin", 403); }
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return fail("Send an application/json request", 415);
  const reader = request.body?.getReader();
  if (!reader) return fail("A shopping list is required", 400);
  let text = "", size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) { await reader.cancel(); return fail("Request exceeds the 32 KB limit", 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch { return fail("Could not read the request", 400); }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail("Invalid JSON request", 400); }
  const input = comparisonSchema.safeParse(raw);
  if (!input.success) return fail(`Review your list and preferences: ${input.error.issues[0]?.message ?? "invalid input"}`, 400);
  try {
    return Response.json(await compareDemo(input.data), { headers });
  } catch {
    console.error("Comparison failed", { code: "INTERNAL_COMPARISON_ERROR" });
    return fail("Comparison is temporarily unavailable. Your list is still here; please try again.", 500);
  }
}
