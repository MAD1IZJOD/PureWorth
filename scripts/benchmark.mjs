import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url), ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { parseShoppingList, matchProducts, exampleList } = require("../lib/matching.ts");
const { demoCatalog, retailers } = require("../lib/catalog.ts");
const { optimizeBasket } = require("../lib/optimizer.ts");
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)];
function measure(fn, repeats) {
  const times = []; let value;
  for (let i = 0; i < repeats + 5; i++) { const start = performance.now(); value = fn(); if (i >= 5) times.push(performance.now() - start); }
  return { medianMs: quantile(times, 0.5), p95Ms: quantile(times, 0.95), explored: value?.explored, status: value?.status };
}
const weekly = parseShoppingList(exampleList), heavy = parseShoppingList(Array(12).fill("Amul milk 1 L").join(", "));
const products = demoCatalog("bengaluru"), weeklyMatches = matchProducts(weekly, products, "bengaluru"), heavyMatches = matchProducts(heavy, products, "bengaluru");
const results = { generatedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), pure: {
  parse: measure(() => parseShoppingList(exampleList), 100), matching: measure(() => matchProducts(weekly, products, "bengaluru"), 100),
  weeklyOptimization: measure(() => optimizeBasket(weeklyMatches, retailers), 50), cappedOptimization: measure(() => optimizeBasket(heavyMatches, retailers), 10),
}, load: [], browser: null, generatorPeakRssMiB: 0 };

// This harness owns a loopback-only server. It never accepts a remote target.
const base = "http://127.0.0.1:3100";
async function server() {
  try { await fetch(base, { signal: AbortSignal.timeout(300) }); throw new Error("Port 3100 is occupied; stop that server before benchmarking"); } catch (e) { if (e.message.startsWith("Port 3100")) throw e; }
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"], { stdio: "ignore", windowsHide: true, env: { ...process.env, PUREWORTH_ENV: "local", VERCEL: "0", PUREWORTH_ANALYTICS: "false", PUREWORTH_FEEDBACK: "false" } });
  const stop = () => { if (child.exitCode !== null) return; if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); else child.kill(); };
  try {
    for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error("Benchmark server exited"); try { if ((await fetch(base)).ok) return stop; } catch {} await pause(100); }
    throw new Error("Benchmark server did not start");
  } catch (error) { stop(); throw error; }
}
function input(items) { return { items, location: "bengaluru", retailerIds: ["freshlane", "daily", "pantry"], maxRetailers: 3 }; }
async function load(concurrency, items, perUser) {
  const stop = await server(), times = [], codes = {}; let incomplete = 0, bounded = 0, transportErrors = 0;
  const started = performance.now();
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (let n = 0; n < perUser; n++) {
        const start = performance.now();
        try {
          const response = await fetch(`${base}/api/compare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input(items)), signal: AbortSignal.timeout(15_000) });
          codes[response.status] = (codes[response.status] ?? 0) + 1;
          const data = await response.json();
          if (response.ok && !data.pricing?.comparisonComplete) incomplete++;
          if (data.result?.status === "bounded") bounded++;
          if (data.result?.explored > 200_000) throw new Error("Search cap exceeded");
        } catch { transportErrors++; }
        times.push(performance.now() - start);
        results.generatorPeakRssMiB = Math.max(results.generatorPeakRssMiB, process.memoryUsage().rss / 1024 ** 2);
      }
    }));
    const durationSeconds = (performance.now() - started) / 1000, total = times.length;
    return { concurrency, requests: total, durationSeconds, medianMs: quantile(times, 0.5), p95Ms: quantile(times, 0.95), throughputPerSecond: total / durationSeconds, codes, incomplete, bounded, transportErrors, unexpectedErrorPercent: ((transportErrors + incomplete + Object.entries(codes).filter(([code]) => Number(code) >= 500).reduce((sum, [, n]) => sum + n, 0)) / total) * 100, rateLimited: codes[429] ?? 0 };
  } finally { stop(); await pause(150); }
}
for (const concurrency of [1, 10, 25, 50, 100]) results.load.push(await load(concurrency, weekly, 2));
results.expensive = await load(1, heavy, 10);
const stop = await server(), browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  let jsBytes = 0, jsGzipBytes = 0;
  const bodies = [];
  page.on("response", response => { if (response.url().includes("/_next/") && response.url().split("?")[0].endsWith(".js")) bodies.push(response.body().then(body => { jsBytes += body.length; jsGzipBytes += gzipSync(body).length; }).catch(() => {})); });
  await page.goto(base); await page.getByRole("button", { name: "Try a weekly essentials list" }).waitFor(); await page.waitForLoadState("networkidle");
  const navigation = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { responseStartMs: n.responseStart, domContentLoadedMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd, firstContentfulPaintMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null }; });
  const exampleStarted = performance.now(); await page.getByRole("button", { name: "Try a weekly essentials list" }).click(); await page.getByTestId("shopping-item").first().waitFor(); const exampleMs = performance.now() - exampleStarted;
  const resultStarted = performance.now(); await page.getByRole("button", { name: "Compare my list", exact: true }).click(); await page.getByRole("button", { name: "Find my best basket", exact: true }).click(); await page.getByTestId("basket-total").waitFor();
  await Promise.all(bodies);
  results.browser = { engine: "Chromium", viewport: 390, navigation, exampleMs, reviewAndResultsMs: performance.now() - resultStarted, jsBytes, jsGzipBytes, note: "Loopback, unthrottled, single measured browser journey; not a field Core Web Vitals claim" };
} finally { await browser.close(); stop(); }
mkdirSync("test-results", { recursive: true }); writeFileSync("test-results/benchmark.json", JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
if (results.load.some(r => r.transportErrors || r.unexpectedErrorPercent > 0) || results.expensive.transportErrors) process.exitCode = 1;
