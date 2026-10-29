import { comparisonSchema, type ComparisonResponse } from "../../../lib/domain";
import { demoAdapter } from "../../../lib/catalog";
import { matchProducts } from "../../../lib/matching";
import { optimizeBasket } from "../../../lib/optimizer";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Cross-origin requests are unavailable", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return fail("Send an application/json request", 415);
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
    const { items, location, ...options } = input.data;
    const [catalog, allRetailers] = await Promise.all([demoAdapter.search("", location), demoAdapter.getRetailers(location)]);
    const selectedProducts = catalog.filter(p => options.retailerIds.includes(p.retailerId as typeof options.retailerIds[number]));
    const matches = matchProducts(items, selectedProducts, location);
    const result = optimizeBasket(matches, allRetailers, options);
    const response: ComparisonResponse = { matches, result, retailers: allRetailers };
    return Response.json(response, { headers });
  } catch (error) {
    console.error("Demo comparison failed", error);
    return fail("Comparison is temporarily unavailable. Your list is still here; please try again.", 500);
  }
}
