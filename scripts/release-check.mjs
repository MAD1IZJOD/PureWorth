import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url), ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const { betaConfig } = require("../lib/beta/config.ts"), { admission } = require("../lib/beta/admission.ts");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const check = (condition, message) => { if (!condition) throw new Error(message); console.log(`PASS: ${message}`); };
const identity = "Madhavan <175943252+MAD1IZJOD@users.noreply.github.com>";
check(git("status", "--porcelain") === "", "clean working tree");
check(git("branch", "--show-current") === "main", "main branch");
check(git("remote", "get-url", "origin") === "https://github.com/MAD1IZJOD/PureWorth", "correct origin");
for (const key of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) check(git("var", key).startsWith(`${identity} `), `exact ${key}`);
const head = git("rev-parse", "HEAD");
check(git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0] === head, "actual origin/main synchronization");
check(JSON.parse(readFileSync("vercel.json", "utf8")).git.deploymentEnabled === false, "automatic Git deployments disabled in repository policy");
check(existsSync(".next/pureworth-verification.json"), "full local release evidence exists; run npm run verify first");
const proof = JSON.parse(readFileSync(".next/pureworth-verification.json", "utf8"));
const since = git("diff", "--name-only", `${proof.commit}..HEAD`).split(/\r?\n/).filter(Boolean);
check(since.every(path => path === "README.md" || /^docs\/.*\.md$/.test(path)), "tested source unchanged except documentation");
check(proof.buildId === readFileSync(".next/BUILD_ID", "utf8").trim() && Date.now() - Date.parse(proof.verifiedAt) < 7 * 86400_000, "verification matches this build and is under seven days old");
check(proof.units >= 227 && proof.browsers >= 930 && proof.typecheck && proof.lint && proof.build && proof.audit, "all current unit, browser, lint, type, build and audit gates passed");
check(proof.benchmark.load.length === 5 && proof.benchmark.load.every(r => r.unexpectedErrorPercent === 0) && proof.benchmark.expensive.bounded === 10, "local load tests passed without incomplete baskets and retained search limits");
const signatures = /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}/;
for (const file of git("ls-files").split(/\r?\n/)) {
  check(!/^\.env(?!\.example$)/.test(file), `no private environment file tracked: ${file}`);
  if (signatures.test(readFileSync(file, "utf8"))) throw new Error(`Review possible secret in ${file}; value withheld`);
}
const config = betaConfig();
const secrets = [config.accessToken, config.redis?.token].filter(Boolean);
function scanClient(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) scanClient(path);
    else if (/\.(js|html|json|map)$/.test(path) && secrets.some(secret => readFileSync(path, "utf8").includes(secret))) throw new Error("Configured secret found in browser output; value and path withheld");
  }
}
scanClient(".next/static");
console.log("PASS: focused tracked-source and configured-secret browser-output scans");
if (process.argv.includes("--hosted")) {
  check(config.deployed && config.access === "protected" && !!config.redis, "hosted protected access and shared storage configured");
  check(existsSync(".vercel/project.json"), "Vercel project explicitly linked");
  check(await admission(config).healthy(), "required shared protection is reachable");
  const ticket = await admission(config).acquire("compare"); check(ticket.allowed, "shared admission probe succeeds"); if (ticket.allowed) await ticket.release();
  console.log("Local hosted preflight passed. Dashboard protection and actual protected deployment smoke tests are still required. No deployment performed.");
} else console.log("Local release checks passed. Hosted configuration and deployment protection are NOT verified. No deployment performed.");
