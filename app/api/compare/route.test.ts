import { expect, it } from "vitest";
import { POST } from "./route";
import { exampleList, parseShoppingList } from "../../../lib/matching";
import type { ComparisonResponse } from "../../../lib/domain";

const body = { items: parseShoppingList(exampleList), location: "bengaluru", approved: [], retailerIds: ["freshlane", "daily", "pantry"], maxRetailers: 3, fewerDeliveryTolerance: 2000 };
const request = (data: unknown = body) => new Request("http://localhost:3000/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

it("runs the real parser → catalog → matching → optimizer service", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const result: ComparisonResponse = await response.json();
  expect(result.matches).toHaveLength(5); expect(result.result.status).toBe("optimal");
  const basket = result.result.cheapest!;
  expect(basket.total).toBe(basket.orders.reduce((sum, order) => sum + order.total, 0));
  expect(basket.orders.flatMap(o => o.lines).every(l => l.product.source === "fictional-demo-fixture")).toBe(true);
});
it("rejects unknown stores, locations, floating quantities, and extra fields", async () => {
  for (const invalid of [{ ...body, location: "unknown" }, { ...body, retailerIds: ["blinkit"] }, { ...body, maxRetailers: 1.5 }, { ...body, paid: true }, { ...body, items: [] }]) {
    expect((await POST(request(invalid))).status).toBe(400);
  }
});
it("rejects malformed JSON and unsupported content types", async () => {
  expect((await POST(new Request("http://localhost/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status).toBe(400);
  expect((await POST(new Request("http://localhost/api/compare", { method: "POST", body: "hello" }))).status).toBe(415);
});
it("caps request bytes even without a Content-Length header", async () => {
  expect((await POST(request({ text: "a".repeat(33000) }))).status).toBe(413);
});
it("rejects cross-origin browser requests", async () => {
  const req = request(); req.headers.set("Origin", "https://example.com");
  expect((await POST(req)).status).toBe(403);
});
it("returns a truthful infeasible response for unknown products", async () => {
  const response = await POST(request({ ...body, items: parseShoppingList("soap 2 packs") }));
  const result: ComparisonResponse = await response.json();
  expect(result.result.status).toBe("infeasible"); expect(result.result.cheapest).toBeNull();
});
