import { afterEach, describe, expect, it, vi } from "vitest";
import { betaConfig, publicBetaFlags } from "./config";
import { betaAccess } from "./access";
import { admission, LocalAdmission, SharedAdmission } from "./admission";
import { errorResponse, HttpError, readJson } from "./http";
import { emitMetric } from "./telemetry";
import { RedisStore } from "./redis";
import { saveFeedback } from "./feedback";

const configured = { VERCEL: "1", PUREWORTH_ACCESS: "protected", PUREWORTH_BETA_TOKEN: "x".repeat(40), UPSTASH_REDIS_REST_URL: "https://fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t".repeat(40), PUREWORTH_FEEDBACK: "true" };
const json = (body: unknown, headers = {}) => new Request("http://localhost/api/test", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("beta configuration and access", () => {
  it("keeps local development credential-free and commerce disabled", () => {
    const config = betaConfig({});
    expect(config.access).toBe("local"); expect(config.redis).toBeNull();
    expect(publicBetaFlags(config)).toEqual({ feedback: false, analytics: false, demoPricing: true, checkout: false, ordering: false });
  });
  it("blocks deployed defaults even if client flags request real commerce", async () => {
    const config = betaConfig({ VERCEL: "1", NEXT_PUBLIC_CHECKOUT: "true", PUREWORTH_ACCESS: "public" });
    expect(config.access).toBe("blocked"); expect(config.checkout).toBe(false); expect(config.liveProviders).toBe(false);
    expect(await admission(config).healthy()).toBe(false);
    expect(await admission(config).acquire("compare")).toMatchObject({ allowed: false, status: 503 });
  });
  it.each(["http://fixture.upstash.io", "https://127.0.0.1", "https://user:secret@fixture.upstash.io", "https://fixture.upstash.io/path", "https://fixture.upstash.io?token=secret", "https://fixture.upstash.io.attacker.example", "https://fixture.upstash.io:444"])("rejects unapproved storage URL %s", value => {
    expect(betaConfig({ ...configured, UPSTASH_REDIS_REST_URL: value }).redis).toBeNull();
  });
  it("serializes only public booleans and isolates production namespace", () => {
    const config = betaConfig({ ...configured, VERCEL_ENV: "production" });
    expect(config.namespace).toBe("production");
    expect(JSON.stringify(publicBetaFlags(config))).not.toContain(config.accessToken);
    expect(JSON.stringify(publicBetaFlags(config))).not.toContain("upstash");
  });
  it("allows only loopback without configured hosted access", () => {
    expect(betaAccess(new Request("http://localhost:3000"), betaConfig({}))).toBeNull();
    const external = new Request("http://localhost:3000", { headers: { host: "public.example", "x-forwarded-host": "localhost" } });
    expect(betaAccess(external, betaConfig({}))?.status).toBe(503);
  });
  it("requires the exact beta credential and configured shared protection", () => {
    const config = betaConfig(configured), url = "https://preview.example";
    expect(betaAccess(new Request(url), config)?.status).toBe(401);
    const auth = `Basic ${Buffer.from(`beta:${config.accessToken}`).toString("base64")}`;
    expect(betaAccess(new Request(url, { headers: { authorization: auth } }), config)).toBeNull();
    expect(betaAccess(new Request(url, { headers: { authorization: `${auth}wrong` } }), config)?.status).toBe(401);
    expect(betaAccess(new Request(url, { headers: { authorization: auth } }), { ...config, redis: null })?.status).toBe(503);
  });
  it("does not send invitation credentials over plain HTTP in a hosted environment", () => {
    const config = betaConfig(configured);
    const request = new Request("http://preview.example", { headers: { authorization: `Basic ${Buffer.from(`beta:${config.accessToken}`).toString("base64")}` } });
    expect(betaAccess(request, config)?.status).toBe(503);
  });
});

describe("bounded request parsing", () => {
  it("accepts valid data and ignores brackets inside quoted strings", async () => {
    expect(await readJson(json({ text: '[{{"x"' }))).toEqual({ text: '[{{"x"' });
  });
  it.each([
    [new Request("http://localhost", { method: "POST", body: "{}" }), 415],
    [json("{broken"), 400], [json("[".repeat(20) + "0" + "]".repeat(20)), 400],
    [json("x".repeat(32769)), 413], [json({}, { "content-length": "50000" }), 413],
    [json({}, { origin: "https://other.example" }), 403], [json({}, { "sec-fetch-site": "cross-site" }), 403],
    [json({}, { "content-encoding": "gzip" }), 415],
  ])("rejects unsafe payload %s", async (request, status) => {
    await expect(readJson(request as Request)).rejects.toMatchObject({ status });
  });
  it("does not return internal exceptions", async () => {
    const response = errorResponse(new Error("Authorization: private-test-value"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-test-value");
  });
});

describe("shared rate and concurrency protection", () => {
  it("does not report ready when ping succeeds but admission writes fail", async () => {
    const limiter = new SharedAdmission({ healthy: async () => true, command: async () => { throw new Error("write access denied"); } }, "preview");
    expect(await limiter.healthy()).toBe(false);
  });
  it("verifies real admission and releases the readiness lease", async () => {
    const command = vi.fn().mockResolvedValueOnce([1, 0, 11]).mockResolvedValueOnce(1);
    const limiter = new SharedAdmission({ command, healthy: async () => true }, "preview");
    expect(await limiter.healthy()).toBe(true); expect(command).toHaveBeenCalledTimes(2);
  });
  it("distinguishes working exhausted protection from a storage outage", async () => {
    const limiter = new SharedAdmission({ command: async () => [0, 1, 0], healthy: async () => true }, "preview");
    expect(await limiter.healthy()).toBe(true);
  });
  it("releases leases once and survives release outages", async () => {
    const command = vi.fn().mockResolvedValueOnce([1, 0, 11]).mockRejectedValueOnce(new Error("private-test-value"));
    const limiter = new SharedAdmission({ command, healthy: async () => true }, "preview");
    const ticket = await limiter.acquire("compare"); expect(ticket.allowed).toBe(true);
    if (ticket.allowed) { await ticket.release(); await ticket.release(); }
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[0][0][0]).toBe("EVAL");
    expect(command.mock.calls[0][0][3]).toContain("{pureworth-preview}");
  });
  it("returns a retry hint on exhaustion", async () => {
    const limiter = new SharedAdmission({ command: async () => [0, 7, 0], healthy: async () => true }, "preview");
    expect(await limiter.acquire("feedback")).toEqual({ allowed: false, status: 429, retryAfter: 7 });
  });
  it.each([null, [1, -1, 0], ["yes", 0, 0], [1, 0], { error: "secret" }])("fails closed on malformed storage admission %s", async reply => {
    const limiter = new SharedAdmission({ command: async () => reply, healthy: async () => false }, "preview");
    expect(await limiter.acquire("compare")).toEqual({ allowed: false, status: 503, retryAfter: 5 });
  });
  it("fails closed on storage outages without local fallback", async () => {
    const limiter = new SharedAdmission({ command: async () => { throw new Error("private"); }, healthy: async () => false }, "preview");
    expect((await limiter.acquire("compare")).allowed).toBe(false); expect(await limiter.healthy()).toBe(false);
  });
  it("bounds concurrent local work and releases slots", async () => {
    const limiter = new LocalAdmission();
    const tickets = await Promise.all(Array.from({ length: 25 }, () => limiter.acquire("compare")));
    expect(tickets.filter(t => t.allowed)).toHaveLength(8);
    expect(tickets.filter(t => !t.allowed).every(t => !t.allowed && t.status === 429)).toBe(true);
    for (const ticket of tickets) if (ticket.allowed) await ticket.release();
    expect((await limiter.acquire("compare")).allowed).toBe(true);
  });
});

describe("private storage and telemetry", () => {
  it("bounds transport, disables redirects and keeps the token out of URLs", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: "PONG" }));
    const store = new RedisStore(betaConfig(configured).redis!, send);
    expect(await store.healthy()).toBe(true);
    expect(send.mock.calls[0][0]).toBe("https://fixture.upstash.io");
    expect(send.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store", method: "POST" });
    expect(send.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([new Response("invalid"), Response.json({ error: "private-test-value" }), new Response("x".repeat(32769))])("rejects unsafe storage replies", async response => {
    const store = new RedisStore(betaConfig(configured).redis!, vi.fn<typeof fetch>().mockResolvedValue(response));
    expect(await store.healthy()).toBe(false);
  });
  it("logs only bounded operational fields and ignores monitoring failures", () => {
    const lines: string[] = []; const sink = (line: string) => { lines.push(line); };
    emitMetric({ kind: "request", operation: "compare", status: 429, durationMs: 12 }, sink);
    emitMetric({ kind: "request", operation: "compare", body: "private-test-value" }, sink);
    emitMetric({ kind: "request", operation: "private-test-value" }, sink);
    expect(lines).toHaveLength(1); expect(lines[0]).not.toContain("private-test-value");
    expect(() => emitMetric({ kind: "request", operation: "compare" }, () => { throw new Error("monitor down"); })).not.toThrow();
  });
  it("requires configured private feedback storage", async () => {
    await expect(saveFeedback({ category: "bug", consent: true }, betaConfig({}))).rejects.toMatchObject({ status: 503 });
  });
  it.each([{ category: "other", consent: true }, { category: "bug", consent: false }, { category: "bug", consent: true, message: "x".repeat(1501) }, { category: "bug", consent: true, website: "spam" }, { category: "bug", consent: true, email: "private" }])("rejects invalid or spam feedback", async raw => {
    await expect(saveFeedback(raw, betaConfig(configured), { command: vi.fn() })).rejects.toBeInstanceOf(HttpError);
  });
  it("acknowledges only confirmed writes and prevents duplicates", async () => {
    const command = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockRejectedValueOnce(new Error("secret"));
    const raw = { category: "bug", consent: true, message: "Small-screen issue" };
    expect(await saveFeedback(raw, betaConfig(configured), { command })).toEqual({ saved: true });
    await expect(saveFeedback(raw, betaConfig(configured), { command })).rejects.toMatchObject({ status: 409 });
    await expect(saveFeedback(raw, betaConfig(configured), { command })).rejects.toMatchObject({ status: 503 });
    const record = JSON.parse(command.mock.calls[0][0].at(-1));
    expect(Object.keys(record).sort()).toEqual(["category", "createdAt", "id", "message"]);
  });
});
