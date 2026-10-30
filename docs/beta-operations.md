# Controlled beta operations

Status: local implementation; no Vercel deployment or project protection has been verified. No unrestricted public release is authorized. All prices, stock, fees and savings are fictional estimates. Checkout, ordering and actual retailer connections stay disabled in server code.

## Release policy and official sources

Research checked 30 October 2026:

- Vercel documents [`git.deploymentEnabled: false`](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments). The tracked `vercel.json` applies this to every branch. Each file still goes straight to main, with its own commit and immediate push. Do not enable automatic Git deployments or a deployment webhook around this policy.
- [Deployment Protection](https://vercel.com/docs/deployment-protection) distinguishes Standard Protection, which excludes production domains, from All Deployments. Check the actual project scope, plan and protection method before uploading source. A repository setting does not prove the dashboard state. Team authentication is not a consumer invitation system.
- [`vercel deploy`](https://vercel.com/docs/cli/deploy) supports preview deployment; production `--skip-domain` defers domain assignment, rather than guaranteeing privacy. [`vercel promote`](https://vercel.com/docs/cli/promote) assigns production domains later. Do not use promotion as access control.
- [Upstash REST](https://upstash.com/docs/redis/features/restapi) supports Redis scripting through HTTPS. Only a server-configured HTTPS `*.upstash.io` origin is accepted; redirects, credentials in URLs and arbitrary destinations are rejected. Standard tokens stay server-side.
- [Vercel request headers](https://vercel.com/docs/headers/request-headers) describes platform IP forwarding. This implementation deliberately uses no IP-based identity: neither forwarded headers nor client IDs can change its global budgets.

These sources document platform capabilities, not account authorization, plan entitlement or an actual successful deployment.

## Local operation

Use Node.js 24 (the package also permits compatible Node 22+) and PowerShell:

```powershell
Set-Location 'D:\personal projects\PureWorth'
npm ci --ignore-scripts
npx playwright install chromium firefox webkit
npm run dev
```

Open http://127.0.0.1:3000. No environment file is needed. For production-mode local testing, run `npm run build` then `npm run start`. The access proxy permits loopback local requests; it blocks non-loopback hosts without protected configuration. Do not expose this loopback development mode through an external proxy that rewrites Host to localhost.

## Configuration and secrets

`.env.example` contains names and empty placeholders only. Store actual values in ignored `.env.local` or Vercel's protected environment-variable settings, separately scoped to preview and production. Never put credentials in `NEXT_PUBLIC_*`, CLI arguments, query strings, screenshots or committed files.

| Setting | Meaning |
| --- | --- |
| `PUREWORTH_ENV` | `local` for local use; `staging` or `production` forces hosted rules. Vercel runtime detection also forces hosted rules. |
| `PUREWORTH_ACCESS` | Only `protected` can enable hosted access. Missing, misspelled or `public` stays blocked. |
| `PUREWORTH_BETA_TOKEN` | Unique cryptographically random 32–256 printable characters. Shared invitation password; username is `beta`. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Approved account's server-only REST credentials; both must validate. Use a dedicated PureWorth database/ACL. |
| `PUREWORTH_FEEDBACK` | `true` enables the form only when private Redis storage is configured. Defaults off. |
| `PUREWORTH_ANALYTICS` | `true` permits optional consented usage categories. Defaults off. |

The page receives public boolean flags only. Demo pricing is always on; no environment flag can authorize checkout, ordering or a live provider. Preview and production Redis keys have separate namespaces. Preview deployments intentionally share the preview safety budget; use a separate dedicated database if staging isolation requires it.

## Beta invitation and transport

The application proxy requires HTTPS, protected mode, a valid shared invitation token and valid storage configuration before challenging for HTTP Basic credentials. It compares hashed credentials with a constant-time equality function. Every page and API except constant liveness is gated; static framework assets contain no privileged configuration. Actual limiter availability is enforced again at API admission.

Distribute the invitation privately. Test both missing/wrong credentials and a correct credential on the actual HTTPS deployment. Check HTML, RSC/navigation, APIs and alternate deployment URLs. Do not place credentials in a URL. Browsers may retain Basic credentials until the session closes. This is a small-cohort shared invitation, with rotation-based revocation; it has no individual accounts, invitations, logout or per-user audit trail. Add a dedicated invitation service before needing those features.

Vercel protection is an additional perimeter. Select a supported method compatible with the intended testers; verify all relevant URLs. Never disable protection merely because a tester lacks a Vercel team account.

## Abuse protection and failure policy

Hosted admission uses one atomic Redis EVAL operation per attempt. Redis TIME drives token refill. A sorted set holds expiring concurrency leases; release is idempotent, and crashed work frees its slot after 20 seconds. Vercel API duration is capped at 15 seconds. A failed release does not invalidate a completed response. Malformed replies, timeouts or outages return 503 with Retry-After; there is no deployed fallback to memory.

| Operation | Global burst | Refill/second | Shared concurrent leases |
| --- | --- | --- | --- |
| Comparison, matching and repricing | 12 | 2 | 8 |
| Feedback | 3 | 0.1 | 2 |
| Usage events | 20 | 5 | 4 |

Local development uses bounded process budgets: comparison 120/minute, eight concurrent; feedback five/minute, two concurrent; usage 120/minute, four concurrent. A separate comparison core guard permits at most 12 valid starts/second and four concurrent operations per process, protecting the simulated provider quotas. The same core guard remains an additional hosted safeguard. It was added after load testing reproduced partial baskets under bursts.

Exhaustion returns 429 and a Retry-After hint. These conservative global limits protect a small beta; they are not per-user fairness, bot detection or a promise that 100 simultaneous requests are all served. One noisy tester can consume the shared budget. Add platform WAF controls and measured capacity tuning before wider access. Parsing on the browser runs only on explicit submission; the expensive server flow is entirely behind admission. The optimizer retains 12 items, three stores and 200,000 nodes. Synchronous capped search cannot be cancelled once running.

No real Redis credential is available in this workspace. REST success/failure contracts are tested with deterministic fixtures; actual Redis Lua execution, cross-instance admission and hosting latency must be verified against the approved database before enabling traffic. Until then hosted access remains blocked by missing configuration.

## API and browser security

Mutating APIs use bounded UTF-8 streaming reads with five-second body deadlines, origin/fetch-site checks, JSON content-type checks, compressed-body rejection, nesting limits and strict schemas. Comparison bodies are limited to 32 KB, feedback to 8 KB and analytics to 1 KB. Unknown input fields cannot increase computational limits. Server-generated request IDs are never copied from user headers. API responses are no-store and do not return exception text.

Browser headers restrict resources to the same origin, disallow object embedding and framing, restrict form actions, disable sensitive device APIs and prevent indexing. HSTS is configured for Vercel HTTPS deployments. Inline scripts/styles remain permitted for Next hydration and existing inline styles; production eval and external script/connect origins are blocked. This CSP is defense in depth, not a substitute for escaping/validation or a nonce-based strict CSP. Verify all browsers before tightening it further.

Zod runs with `jitless: true` before client schemas are created. This avoids its optional runtime-code-generation probe, which otherwise produced a Firefox CSP warning. Validation rules remain enabled; do not add `unsafe-eval` to remove that warning. See [Zod's CSP guidance](https://zod.dev/compile).

## Logs, metrics and analytics

Structured operational logs contain only allowlisted event categories, server-generated request ID, status, integer duration, explored node count, bounded-search flag and failure counts. No raw body, shopping item, PIN, IP, header, exception, API key or address is accepted by the log schema. Sink failures are swallowed. Comparison core duration includes matching/provider/quote work; the benchmark separately measures the pure optimizer.

Aggregate request statuses and durations in the host's private log/metric service to obtain counts, latency, errors and rejection rates. Optimization events provide bounded-search, provider-failure and quote-failure counts. Liveness supports availability monitoring. No public metrics/debug endpoint exists. No Sentry, external drain, alert destination or uptime service has been configured. Retention, dashboard access, alerts and drain redaction are operator release gates, not implemented services.

Optional usage events have an explicit page-only opt-in and fixed event names. They carry no shopping contents or persistent identifier. No tracking cookies, local storage, fingerprinting or cross-site service is used. Do Not Track and Global Privacy Control override consent. Hosting services can still process connection metadata, so this is not a claim of complete anonymity. A plan event records the download request, not proof the user saved a file. Analytics failures cannot block shopping.

## Feedback and retention

The form needs no account or contact information. It supports a category, optional text under 1,500 characters, explicit send consent and a honeypot. Rate limits and ten-minute content deduplication limit spam. The private Redis list retains at most 500 records and expires after 30 days with no submissions; this is an idle expiry, not an absolute per-record 30-day retention promise. Establish an absolute retention/export/deletion policy before enabling it for a wider audience.

Records contain only random record ID, category, text and timestamp. No public read endpoint exists. Access the inbox through the approved provider's private console with restricted operator permissions; do not paste or commit real feedback. Storage acknowledgement is required for success. An unconfirmed write is honestly described as uncertain because it may have reached storage before a timeout. Missing configuration disables the form and API submission. Do not enable the flag just to make the button appear functional.

## Health and readiness

- `/api/health`: constant `alive`, process availability only; performs no provider or storage requests.
- `/api/ready`: protected, no-store; `ready`/200 when required admission protection is available, `unavailable`/503 when it is not, or `busy`/429 for probe exhaustion. Hosted checks exercise actual atomic admission and release a successful lease; a plain Redis ping cannot prove write permission. An exhausted but working shared limiter is healthy protection. Each successful hosted probe consumes one comparison token. Local readiness makes no external calls. A configured optional service is not claimed healthy just because its flag is on.
- Provider state remains explicit in the normal comparison response: real connections disabled, fictional providers simulated. Readiness does not certify inventory, final checkout, feedback delivery or commercial access.

Probe protection is process-local and bounded because readiness is behind access control. Use a moderate authenticated monitoring interval; do not expose it as an unprotected general-purpose Redis ping.

## Verification and performance

```powershell
npm run verify
npm run check:release
```

The verifier requires an unchanged clean checkout, then runs unit/API tests, type checking, warning-free lint, production build, all Chromium/Firefox/WebKit projects, dependency audit and the local benchmark. It writes ignored `.next/pureworth-verification.json` only after success. Release checks require matching build/source evidence, actual origin/main synchronization, Git identities, disabled automatic Git deployment policy and focused secret scans. Documentation-only commits may follow the tested source. Local evidence is not tamper-proof CI attestation and does not verify a Vercel dashboard.

`npm run benchmark` owns loopback port 3100 and refuses an occupied port. It restarts its own production server for each of 1/10/25/50/100 active-user bursts, sends two requests per user, then runs ten expensive capped requests. It reports median/p95, successful-response p95, throughput including 429s, incomplete/error percentage, status distribution and process memory when available. It separately profiles parsing/matching/optimization and a 390px Chromium journey, with initial/journey JavaScript sizes. It never accepts a third-party target.

Measured local budgets are intentionally modest: API burst p95 under 2s, repeated capped request p95 under 1.5s, initial gzip JavaScript under 220 KB and review-to-results journey under 2.5s. They are regression guards based on loopback measurements, not internet/mobile field promises. A short burst is not a sustained soak test; 429 throughput is not checkout capacity. Keep the baseline/final values and environment in the delivery report.

The final local verification tested application source `5371f611fe96fc4fedc89f528babface91d8d8c9`, build `J7lEBPhcwxmqUH7Gc9_t4`, on 31 October 2026 IST: 230 unit/API tests and all 960 browser checks passed, as did type checking, zero-warning lint, production build, dependency audit and measured performance budgets. The [Phase 4 delivery report](phase-4-delivery.md) records the actual measurements and failed checks that led to fixes. Release evidence is generated locally and intentionally ignored by Git; rerun it after any source change.

## Protected staging release gates

1. Preserve the one-file/commit/push rules. Finish all source changes; run verification on a clean synchronized main. Investigate every failed check rather than bypassing it.
2. Obtain access to the intended Vercel project and approved Redis account. Inspect actual Git integration/hooks, Node 24 runtime, environment scopes and deployment protection before linking/uploading. Keep `git.deploymentEnabled` false and avoid any workflow that publishes every push.
3. Configure a dedicated Redis database, verify actual EVAL/lease/refill/concurrency/expiry behavior and storage outage fail-closed behavior. Review retention, credentials and operator access. Configure only server-side environment variables.
4. Run `npm run check:release -- --hosted` in the appropriately configured environment. It performs a shared-store health/admission probe but does not deploy or certify the external perimeter.
5. Create a manual protected preview with `vercel deploy --target preview` only after the external protection settings are verified. Keep the actual URL private. Record its immutable deployment ID and tested source SHA.
6. Verify unauthenticated access rejection, authenticated page/API access, readiness, security headers, demo notices, feedback and provider outage behavior, all shopping controls, download and disabled ordering at that URL. Test alternate URLs/RSC routes and ensure no secret is in returned HTML/assets. Do not remove protection to run tests.
7. Do not promote or assign a public production domain without explicit user approval and separate release verification. A production `--skip-domain` upload is not automatically private.

There is currently no verified deployment URL. No CLI, project link, Vercel token or Redis credentials were found in the workspace environment. A separate read-only browser inspection found an authenticated Vercel session, but searching for PureWorth returned no project in the inspected team; this does not rule out projects elsewhere. The user confirmed that no dedicated Upstash database exists. No project, database, credential or deployment was created.

`npm run check:release` passed locally. `npm run check:release -- --hosted` exited with code 1 at the required hosted protected-access/shared-storage configuration check. This is an unresolved release gate. Provision the approved dedicated database and intended protected project, configure private environment values, and verify actual Redis scripts, outages and the HTTPS staging perimeter before inviting hosted testers. The separate local staging-mode smoke check returned 503/no-store for the page, comparison, feedback and readiness without configuration, while constant liveness stayed 200; that verifies fail-closed application behavior, not Vercel's external protection.

## Recovery and incidents

| Incident | Immediate action |
| --- | --- |
| Failed build/deployment | Keep the previous protected deployment serving; retain logs with secrets redacted. Fix one file per new commit and push, rerun gates. |
| High error/429 rate | Keep protection on, pause invitations, inspect aggregate status/latency/cap metrics. Reduce traffic or tighten the platform perimeter; do not raise limits blindly. |
| Redis outage | Expect 503/Retry-After and unavailable readiness. Restore approved storage or keep access blocked. Never add a deployed memory fallback. |
| Monitoring outage | Shopping continues locally; restore the private sink/drain and check gaps before opening access further. |
| Feedback outage | Disable new collection in the next controlled deployment; treat unconfirmed writes as uncertain. Check the private inbox without exposing submitted text. |
| Possible exposure | Immediately restrict all deployments/URLs at the platform perimeter, revoke affected credentials, investigate private logs and follow the incident notification process. Do not copy secret values into issues. |
| Disable beta access | Restrict all relevant deployment URLs through platform protection immediately. Deploy blocked access settings through the controlled flow; environment edits alone do not necessarily update existing deployment snapshots. |
| Restore a known build | For an eligible previously aliased production deployment, use [Vercel rollback](https://vercel.com/docs/instant-rollback) within the account's plan permissions. Ordinary preview builds are not eligible for Instant Rollback: direct the controlled tester cohort back to the prior protected immutable preview URL, or create a controlled redeployment of the verified source. Recheck environment/protection compatibility, health and shopping smoke tests. |

Never force-push, reset, rebase, amend or rewrite history. A code-level revert must use ordinary new single-file commits with the exact Madhavan identities and immediate push. Platform rollback restores deployment state independently of Git history; it does not undo feedback storage or secrets already exposed.
