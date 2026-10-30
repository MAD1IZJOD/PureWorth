import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("status", "--porcelain")) throw new Error("Verification requires a clean checkout");
const commit = git("rev-parse", "HEAD");
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
if (!existsSync(npmCli)) throw new Error("Run this verifier through npm run verify");
async function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(output.replace(/\u001b\[[0-9;]*m/g, "")) : reject(new Error(`Verification failed with exit ${code}`)));
  });
}
const unitOutput = await run([npmCli, "test"]);
const units = Number(unitOutput.match(/Tests\s+(\d+) passed/)?.[1]);
await run([npmCli, "run", "typecheck"]); await run([npmCli, "run", "lint"]); await run([npmCli, "run", "build"]);
// Respect the configured single worker: parallel journeys can intentionally
// exhaust the app's shared local safety budget. Load tests exercise bursts apart.
const browserOutput = await run(["node_modules/@playwright/test/cli.js", "test"]);
const browsers = Number(browserOutput.match(/(\d+) passed \(/)?.[1]);
if (!units || !browsers || /\d+ (?:failed|skipped|flaky)/.test(browserOutput) || JSON.parse(readFileSync("test-results/.last-run.json", "utf8")).status !== "passed") throw new Error("All browser and unit checks must pass without skips or flaky tests");
await run([npmCli, "audit", "--json"]);
const benchmarkOutput = await run(["scripts/benchmark.mjs"]);
if (!benchmarkOutput.includes('"load"')) throw new Error("Missing benchmark evidence");
if (commit !== git("rev-parse", "HEAD") || git("status", "--porcelain")) throw new Error("Source changed during verification; rerun against a stable checkout");
const proof = { commit, buildId: readFileSync(".next/BUILD_ID", "utf8").trim(), verifiedAt: new Date().toISOString(), units, browsers, typecheck: true, lint: true, build: true, audit: true, benchmark: JSON.parse(readFileSync("test-results/benchmark.json", "utf8")) };
writeFileSync(".next/pureworth-verification.json", JSON.stringify(proof, null, 2));
console.log(`Verified ${commit}: ${units} unit/API and ${browsers} browser tests. Release evidence saved locally.`);
