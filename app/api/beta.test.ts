import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { exampleList, parseShoppingList } from "../../lib/matching";
import type { ComparisonResponse } from "../../lib/domain";

const body = { items: parseShoppingList(exampleList), location: "bengaluru", retailerIds: ["freshlane", "daily", "pantry"], maxRetailers: 3 };
const request = (value: unknown, route = "compare", headers = {}) => new Request(`http://localhost/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) });
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("returns private correlation and timing headers without echoing a supplied identifier", async () => {
  const { POST } = await import("./compare/route");
  const response = await POST(request(body, "compare", { "x-request-id": "private-test-value", "x-forwarded-for": "1.2.3.4" }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/); expect(response.headers.get("server-timing")).toMatch(/^request;dur=\d+$/);
});
it("rejects concurrent comparison bursts rather than returning quota-damaged baskets", async () => {
  const { POST } = await import("./compare/route");
  const replies = await Promise.all(Array.from({ length: 25 }, () => POST(request(body))));
  expect(replies.some(r => r.status === 429)).toBe(true);
  for (const response of replies) {
    expect([200, 429]).toContain(response.status);
    if (response.status === 429) expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    else { const data: ComparisonResponse = await response.json(); expect(data.pricing?.comparisonComplete).toBe(true); expect(data.result.cheapest?.total).toBe(103900); }
  }
});
it("ignores spoofed proxy identities when the hosted limiter is unconfigured", async () => {
  vi.stubEnv("VERCEL", "1");
  const { POST } = await import("./compare/route");
  const response = await POST(request(body, "compare", { "x-forwarded-for": "127.0.0.1", "x-vercel-forwarded-for": "127.0.0.1" }));
  expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("30");
  expect(await response.text()).not.toContain("UPSTASH");
});
it("keeps comparison usable when the monitoring sink throws", async () => {
  vi.spyOn(console, "info").mockImplementation(() => { throw new Error("private-test-value"); });
  const { POST } = await import("./compare/route");
  const response = await POST(request(body)); expect(response.status).toBe(200);
});
it.each([{ ...body, nodeLimit: 900000 }, { ...body, maxRetailers: 4 }, { ...body, retailerIds: ["blinkit"] }, { ...body, items: Array.from({ length: 13 }, (_, i) => ({ ...body.items[0], id: String(i) })) }])("prevents clients from increasing optimizer limits", async value => {
  const { POST } = await import("./compare/route"); expect((await POST(request(value))).status).toBe(400);
});
it("distinguishes liveness from unavailable hosted readiness", async () => {
  vi.stubEnv("VERCEL", "1");
  const health = await import("./health/route"), ready = await import("./ready/route");
  expect(await health.GET().json()).toEqual({ status: "alive" });
  const response = await ready.GET(); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: "unavailable", providers: "simulated" });
});
it("does not request providers for a local readiness probe", async () => {
  const ready = await import("./ready/route"), fetchSpy = vi.spyOn(globalThis, "fetch");
  expect((await ready.GET()).status).toBe(200); expect(fetchSpy).not.toHaveBeenCalled();
});
it("does not claim feedback persistence when disabled", async () => {
  const { POST } = await import("./feedback/route");
  const response = await POST(request({ category: "bug", consent: true }, "feedback"));
  expect(response.status).toBe(503); expect(await response.text()).toContain("Nothing was saved");
});
it("rate-limits feedback spam with Retry-After", async () => {
  const { POST } = await import("./feedback/route");
  for (let i = 0; i < 5; i++) expect((await POST(request({ category: "bug", consent: true }, "feedback"))).status).toBe(503);
  const response = await POST(request({ category: "bug", consent: true }, "feedback"));
  expect(response.status).toBe(429); expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
});
it("acknowledges a configured feedback write only after storage confirms it", async () => {
  vi.stubEnv("PUREWORTH_FEEDBACK", "true"); vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fixture.upstash.io"); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t".repeat(40));
  const { RedisStore } = await import("../../lib/beta/redis");
  vi.spyOn(RedisStore.prototype, "command").mockResolvedValue(1);
  const { POST } = await import("./feedback/route"); const response = await POST(request({ category: "matching", message: "Test fixture only", consent: true }, "feedback"));
  expect(response.status).toBe(201); expect(await response.json()).toEqual({ saved: true });
});
it("keeps analytics disabled by default", async () => {
  const { POST } = await import("./analytics/route");
  expect((await POST(request({ event: "session_started", consent: true }, "analytics"))).status).toBe(404);
});
it("logs configured consented usage without accepting list content or personal fields", async () => {
  vi.stubEnv("PUREWORTH_ANALYTICS", "true"); const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const { POST } = await import("./analytics/route");
  expect((await POST(request({ event: "results_viewed", consent: true }, "analytics"))).status).toBe(204);
  expect((await POST(request({ event: "results_viewed", consent: true, list: "private-test-value" }, "analytics"))).status).toBe(400);
  expect((await POST(request({ event: "results_viewed", consent: false }, "analytics"))).status).toBe(400);
  expect(log).toHaveBeenCalledTimes(1); expect(log.mock.calls[0][0]).not.toContain("private-test-value");
});
