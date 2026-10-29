import { expect, it, vi } from "vitest";
import { POST } from "./route";
import { exampleList, parseShoppingList } from "../../../lib/matching";
import type { ComparisonResponse } from "../../../lib/domain";

const body = { items: parseShoppingList(exampleList), location: "bengaluru", retailerIds: ["freshlane", "daily", "pantry"], maxRetailers: 3 };
const request = (change: object = {}) => new Request("http://localhost/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...change }) });

it("returns provenance, capabilities, source freshness and full quotes", async () => {
  const response = await POST(request({ pin: "560001" }));
  expect(response.status).toBe(200);
  const data: ComparisonResponse = await response.json();
  expect(data.pricing).toMatchObject({ mode: "DEMO DATA", comparisonComplete: true, current: true });
  expect(data.pricing!.providers.filter(p => !p.enabled)).toHaveLength(7);
  expect(data.pricing!.quotes.every(q => q.finalPayable !== null && q.context === "BASKET_ESTIMATE")).toBe(true);
  expect(data.result.savings).toBe(1600);
});
it("rejects invalid PINs, arbitrary URLs, requested credentials and unknown simulation states", async () => {
  for (const invalid of [{ pin: "012345" }, { pin: "56000" }, { providerUrl: "http://localhost/private" }, { accessToken: "not-accepted" }, { simulation: "live" }]) expect((await POST(request(invalid))).status).toBe(400);
});
it("accepts valid format without claiming unknown PIN coverage", async () => {
  const data: ComparisonResponse = await (await POST(request({ pin: "999999" }))).json();
  expect(data.result.cheapest).toBeNull(); expect(data.result.savings).toBeNull();
  expect(data.pricing!.providers.find(p => p.id === "daily")!.serviceability!.status).toBe("uncertain");
});
it.each(["stale", "expired", "timeout", "partial", "missing-fees"])("reports %s simulation safely and recovers on a new comparison", async simulation => {
  const data: ComparisonResponse = await (await POST(request({ simulation }))).json();
  expect(data.pricing!.comparisonComplete).toBe(false);
  expect(data.result.savings).toBeNull(); expect(data.result.reference).toBeNull();
  expect(data.pricing!.mode).toBe("DEMO DATA");
  const recovered: ComparisonResponse = await (await POST(request())).json();
  expect(recovered.result.cheapest!.total).toBe(103900);
});
it("rejects a misleading JSON content type", async () => {
  const req = request(); req.headers.set("Content-Type", "text/application/jsonish");
  expect((await POST(req)).status).toBe(415);
});
it("cancels a stalled body and releases the concurrency slot", async () => {
  vi.useFakeTimers();
  try {
    let cancelled = false;
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: "half" };
    const pending = POST(new Request("http://localhost/api/compare", init));
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).status).toBe(408); expect(cancelled).toBe(true);
    expect((await POST(new Request("http://localhost/api/compare", { method: "POST", body: "invalid" }))).status).toBe(415);
  } finally { vi.useRealTimers(); }
});
it("enforces the HTTP abuse budget with a retry hint", async () => {
  vi.resetModules();
  const isolated = await import("./route");
  for (let count = 0; count < 120; count++) {
    const req = new Request("http://localhost/api/compare", { method: "POST", body: "not json" });
    expect((await isolated.POST(req)).status).toBe(415);
  }
  const response = await isolated.POST(request());
  expect(response.status).toBe(429); expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(await response.json()).toEqual({ error: "Comparison is busy. Your list is still here; retry shortly." });
});
