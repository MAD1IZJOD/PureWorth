# Phase 4 delivery and release status

31 October 2026, Asia/Kolkata. **Local implementation and verification passed. Phase 4 is not release-complete: shared storage and a protected hosted deployment remain unconfigured and unverified.** No public deployment, payment or retailer order was performed.

## A. Source and delivery state

Verified application source: `5371f611fe96fc4fedc89f528babface91d8d8c9`.
Production build: `J7lEBPhcwxmqUH7Gc9_t4`.
Verification completed: `2026-10-30T19:34:10.529Z` (31 October IST).
Starting Phase 3 source: `046437b7e18c5fcf4b4d7e76e79ad6b067e7b0ab`.

Subsequent delivery commits update only README and Markdown documentation. The final handoff gives the delivery HEAD; `git rev-parse HEAD` identifies it without embedding a self-referential commit hash in this report. Release preflight checks that application source still matches the verified build.

## B. Implemented features

The existing grocery flow remains intact: parsing, editable quantities/brands, approved substitutions, three demo service areas, fee-aware optimization, alternative strategies, grouped carts, downloads and disabled checkout. The default fixture still totals **₹1,039 across two stores**, against a valid **₹1,055 Freshlane single-store reference**. Its ₹16 difference is an estimated fixture comparison, never a live saving.

Added environment-aware beta access, shared-store admission contracts, hardened request boundaries, safe operational events, health/readiness, optional private feedback and page-only usage controls, download/render recovery, deferred basket-result code and repeatable verification/release tooling. No database or paid API is required locally.

Confirmed issues fixed during this phase:

- Bursts previously exhausted simulated provider quotas and returned incomplete comparisons. Admission now rejects excess work before those quotas are exhausted.
- A Redis PING could pass while actual admission writes failed. Readiness now probes the admission operation and releases an admitted lease.
- Firefox reported Zod's optional eval probe under CSP. Jitless validation removes the probe while retaining the production eval restriction.
- Both shopping entry forms could lose text entered before hydration. They now read the preserved DOM value on submission.
- Long unbroken brands overflowed Firefox/WebKit mobile layouts. The affected text wraps without clipping the page.
- WebKit skipped the keyboard skip link and failed to restore checkout focus. Explicit focus handling fixes both behaviors.
- Committing a PIN on blur could move the comparison button during WebKit's click. Draft PIN/coverage updates now occur while editing; blur no longer invalidates layout or loses the action.

No optimizer rewrite or retailer/payment integration was introduced.

## C. Security changes

All mutating routes enforce strict schemas, bounded UTF-8 JSON reads, a five-second body deadline, depth limits, content type, origin/fetch-site checks and compressed-body rejection. Limits are 32 KB for comparison, 8 KB for feedback and 1 KB for usage events. Server-owned catalog prices and fee rules remain authoritative. Unknown fields cannot raise the 12-line, three-store or 200,000-node limits.

Hosted configuration defaults to blocked. Protected mode requires HTTPS, a private 32–256-character invitation token and validated shared-store settings. A shared Basic invitation uses username `beta` and constant-time hashed credential comparison; it is a small-cohort gate, not individual account management. Public props contain booleans only. Live providers, checkout and ordering remain disabled in server configuration.

Security headers restrict framing, objects, forms and external resources; production CSP excludes eval. Inline scripts/styles remain permitted for Next hydration and existing styling. Robots indexing is disabled. HSTS applies to Vercel deployments. Errors returned by APIs are sanitized and responses are no-store.

Local release scans found no tracked private environment file or supported secret signature. Configured-secret scanning of browser output is implemented, but there are no real hosted secrets configured to exercise that scan against; repeat it after provisioning. This is a focused scan, not a claim of exhaustive security certification.

## D. Rate limiting and limits

Hosted admission uses an atomic Redis script with Redis TIME, token refill and expiring concurrency leases. Requests never choose an IP/client identity or arbitrary storage URL. REST calls use a validated HTTPS Upstash origin, an 800 ms timeout, no redirects and a bounded response. Failed/malformed storage responses return **503**, never a hosted memory fallback. Exhaustion returns **429 with Retry-After**. Leases expire after 20 seconds; configured API maximum duration is 15 seconds.

| Operation | Global burst | Refill/second | Concurrent leases |
| --- | ---: | ---: | ---: |
| Comparison/matching/repricing | 12 | 2 | 8 |
| Feedback | 3 | 0.1 | 2 |
| Optional usage | 20 | 5 | 4 |

Local comparison protection is 120/minute and eight concurrent requests. A separate core guard allows 12 valid starts/second and four concurrent operations per process, protecting fixture-provider quotas. Local feedback is five/minute and two concurrent. Hosted limits are conservative global budgets: they offer no per-user fairness and one noisy tester can consume them.

**Real Redis Lua execution and cross-instance behavior remain unverified.** Deterministic REST/admission contract tests cover replies, failures, concurrency contracts, release and readiness. The user confirmed no dedicated Upstash database exists. Hosted access stays blocked until actual shared infrastructure is validated.

## E. Monitoring, logs and health

Allowlisted JSON events record server-generated request IDs, status, integer duration, explored nodes, bounded-search state and provider/quote failure counts. Unknown strings/fields, raw shopping text, PINs, IPs, headers, bodies and exceptions are excluded. Sink failures cannot break comparisons. Optional usage sends fixed categories only, defaults off, requires page-only consent and respects DNT/GPC; no tracking identifier, cookie or cross-site destination is used.

Liveness `/api/health` returns only `alive`. Readiness `/api/ready` is protected and returns ready/200, unavailable/503 or probe-budget busy/429. It performs no retailer lookup. Hosted readiness tests actual admission writes; a working exhausted limiter is healthy protection. Successful probes consume one comparison token. Optional-service configuration is not reported as proof of service health.

Private host aggregation, alert routing, retention and uptime monitoring are **not configured**. Operational events work locally; an operator must configure the external monitoring destination before opening access further. Hosting infrastructure may process connection metadata; complete anonymity is not promised.

## F. Actual performance measurements

Environment: Windows, Node 24.18.0, npm 11.16.0, Next 16.4.3, Playwright 1.64.1, unthrottled loopback production servers. The harness owns only `127.0.0.1:3100`, restarts it for each burst and sends two requests per simulated user. These short bursts are not sustained hosted capacity tests.

| Concurrent users | Requests | 200 / 429 | Median ms | All-response p95 ms | Successful p95 ms | Responses/sec, including 429 | Server RSS after MiB |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2 | 2 / 0 | 23.13 | 83.87 | 83.86 | 18.64 | 129.41 |
| 10 | 20 | 12 / 8 | 81.37 | 150.23 | 157.09 | 101.11 | 135.64 |
| 25 | 50 | 12 / 38 | 111.44 | 211.24 | 189.29 | 181.38 | 140.07 |
| 50 | 100 | 12 / 88 | 162.57 | 283.86 | 205.63 | 245.53 | 167.72 |
| 100 | 200 | 12 / 188 | 230.18 | 369.30 | 210.21 | 328.22 | 157.21 |

Every level had **0 transport errors, 0 incomplete successful baskets and 0 unexpected-error percent**. Many requests were intentionally throttled. Throughput above includes cheap rejections and must not be presented as completed-comparison capacity.

Ten sequential expensive 12-line requests all returned 200 and bounded results at exactly 200,000 nodes: median **217.08 ms**, p95 **293.08 ms**, 4.40 responses/sec, server RSS after **168.60 MiB**. Generator peak RSS was **208.51 MiB**. RSS-after is not server peak memory.

| Pure operation | Median ms | p95 ms |
| --- | ---: | ---: |
| Parse weekly list | 0.0416 | 0.0779 |
| Match weekly list | 0.0126 | 0.0368 |
| Optimize weekly list, 382 nodes, optimal | 0.3945 | 0.6489 |
| Optimize 12 lines, 200,000 nodes, bounded | 192.2330 | 455.8253 |

The 390px Chromium journey measured first contentful paint **224 ms**, example-list insertion **73.08 ms**, and review-to-results **1,065.96 ms**. Initial JavaScript was **627,153 bytes / 188,885 gzip bytes**; after results it was **639,118 / 193,041**. Result code is deferred, but the added beta features did not reduce total initial JavaScript versus the baseline.

Baseline was measured before rebuilding Phase 4, using the Phase 3 build `KFahT5julWtB_xTwhXHal` while checkout HEAD was `ae91d1738accd1844210b2119f8038184b96f083`. At 25/50/100 users it returned 17/67/87 incomplete comparisons; final runs returned zero, with explicit throttling instead. Baseline all-response p95 values for 1/10/25/50/100 were 91.63/140.62/227.54/363.16/518.95 ms. Baseline initial gzip JS was 185,559 bytes, FCP 132 ms and review-to-results 258.90 ms. Final JS and journey timings increased; the measured local budgets still passed. Single browser trials and local scheduling differences do not establish field performance improvements.

Budgets: API burst p95 <2,000 ms; repeated capped API p95 <1,500 ms; initial gzip JavaScript <220,000 bytes; review/results journey <2,500 ms. **All passed.** The pure optimizer remains synchronous and exponential with a node cap; browser cancellation cannot interrupt a running enumeration. No larger-basket scalability claim is made.

## G. Browser and viewport coverage

All **960** checks passed: **64 × three actual engines × five viewports**. Engines: Chromium, Firefox and WebKit. Widths: 360, 390, 430, tablet 820 and desktop 1440 px. Each matrix additionally exercises a 320px reduced-motion journey. This is engine testing on Windows, not physical iPhone/Android or full Safari app certification.

The 28 grocery scenarios include mixed mass/volume units, leading decimals, fractional/indivisible packages, pieces versus packs, brands/variants, stock by location, rejected/approved substitutions, single/multi-store baskets, minimum orders, discounts, exact/below delivery thresholds and an actual capped search. Further journeys cover every navigation link, editing/removal, restrictions, strategies, downloads, checkout focus, errors, PINs, provider states and quote invalidation. Console/hydration assertions and overflow checks passed in the final run.

## H. Accessibility

Axe scans reported no violations under the tested WCAG 2 A/AA, 2.1 AA and 2.2 AA tags on landing, matches, results and checkout throughout the matrix. Beta disclosures/provider panels are also scanned. Keyboard skip navigation, error/results focus, native dialog return, disabled controls, empty states, invalid edits, loading, reduced motion and long-content wrapping are exercised. A real browser walkthrough confirmed the example, match review, grouped cart, checkout disclosure, disabled ordering and focus return. Automated scans do not certify all assistive technology or physical devices.

## I. Feedback and privacy

The accessible feedback form supports category, optional text up to 1,500 characters, explicit consent, busy/error/success states and a honeypot. The API validates, rate-limits and deduplicates content for ten minutes, then requires a storage acknowledgement before claiming success. A timed-out/unconfirmed write is described as uncertain because it may have reached storage. No public inbox endpoint exists.

The private Redis list is capped at 500 records and has a **30-day idle expiry**, not a per-record 30-day retention guarantee. Establish an absolute retention/deletion policy and restricted operator access before wider collection. No contact details are required. Missing configuration disables submission with an honest notice. The actual unavailable UI and API behavior passed browser/API tests; acknowledgement and outage paths passed deterministic contract tests. **No real feedback was persisted and configured durable delivery is not verified.** Optional usage is also disabled in this environment.

## J. Deployment state and URL

**Not deployed. No URL exists from this work.** No Vercel project link, CLI/token configuration or Redis credentials were available in the workspace. Read-only browser inspection found an authenticated Vercel session, but the PureWorth project search returned no result in the inspected team; other teams/account resources were not ruled out. No external project/database or credential was created.

## K. Deployment protection

Tracked `vercel.json` disables automatic Git deployments for all branches. Application hosted access defaults to blocked; protected mode is an additional shared invitation gate. Actual Vercel project protection, alternate URLs, Git hooks and production-domain coverage remain **unverified**. Repository configuration alone cannot certify that external perimeter.

`npm run check:release` passed. `npm run check:release -- --hosted` exited **1** at the required hosted protected-access/shared-storage configuration check. A separate local staging-mode server returned 503/no-store for page, comparison, feedback and readiness with no configuration, even with spoofed headers; constant health remained 200. This verifies application failure policy only. Follow [the protected staging gates and rollback procedures](beta-operations.md) before any upload. Public production exposure requires separate explicit authorization.

## L. Build and test results

The Phase 3 baseline was freshly reproduced: 168 unit/API and 280 Chromium checks passed, plus types, lint and build. Final `npm run verify` exited **0** on stable clean source:

| Check | Actual final result |
| --- | --- |
| Vitest | 230 tests passed, 10 files |
| TypeScript | Passed |
| ESLint | Passed with `--max-warnings=0` |
| Next production build | Passed |
| Full Playwright | 960 passed in 34.6 minutes; no failures/skips/flaky tests |
| Local benchmark budgets | Passed |
| Local release preflight | Passed |
| Hosted preflight | Blocked as described above |

Failed checks were investigated and retained: an earlier complete run had **934 passes and 26 failures** from the four native UI issues repeated across viewports. After fixes, all **75 targeted** cross-browser regression checks passed in 2.8 minutes, then the complete fresh run passed. Delayed-hydration regressions were also repeated five times across three engines for both forms: **30 passes**. No test was skipped or deleted to produce a green run. Node's runner emitted the NO_COLOR/FORCE_COLOR environment warning; that is distinct from application console errors and zero-warning lint.

Generated evidence is ignored: `.next/pureworth-verification.json`, `test-results/benchmark.json`, Playwright reports/screenshots/traces. The verifier refuses a changed source checkout and writes proof only after every stage succeeds. Do not use stale evidence after code changes.

## M. Dependency audit

`npm audit --json` passed with **zero known vulnerabilities** across production and development dependencies (459 total reported dependencies). No new dependency was needed for this phase. This is the registry's result at verification time, not a permanent guarantee.

## N. Remaining risks and blockers

PureWorth is ready for local MVP testing. **It is not ready for unrestricted public beta testing, and Phase 4 cannot be classified complete.** Required external actions are a dedicated approved Redis database, private credentials/invitation configuration, the intended Vercel project/protection settings, actual Lua/multi-instance/outage validation and protected HTTPS staging smoke tests. Feedback persistence and monitoring/retention operations must also be validated/configured before their features are enabled for testers.

Other limits: global rather than per-user fairness, shared invitation revocation by rotation, no individual logout/account controls, synchronous bounded search, inline-compatible CSP, short burst measurements rather than soak/field tests, no physical-device checks and no absolute feedback-record expiry. No live prices, authorized retailer access, actual checkout, ordering or payments exist. These restrictions are explicit throughout the product.

## O. Local run commands

From PowerShell, using Node 24:

```powershell
Set-Location 'D:\personal projects\PureWorth'
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:3000`. No environment file is required. For a local production server use `npm run build` followed by `npm run start`. Keep this loopback mode private.

To reproduce verification, stop local servers on ports 3000/3100 first:

```powershell
npx playwright install chromium firefox webkit
npm run verify
npm run check:release
```

`npm run benchmark` repeats only the owned loopback measurements. Hosted settings and the operator sequence are documented in [beta operations](beta-operations.md); do not paste real credentials into source, chat, screenshots or CLI arguments.

## P. Recommended Phase 5

Provision approved shared infrastructure and verify the protected staging gates before inviting a small tester cohort. Establish private metric aggregation, alert ownership, feedback access/deletion and an actual retention policy. Gather field usability/performance measurements and add physical devices/assistive technologies. Tune capacity from admitted-request measurements, not rejection throughput. Separately pursue permitted live-provider onboarding with service-area catalog/fee/quote rights; ordering and payments need their own authorized, consented and reconciled implementation.

## Q. Git workflow and delivery confirmation

All work stayed in the existing requested directory on `main`, with origin `https://github.com/MAD1IZJOD/PureWorth`. The delivery contains **57 new Phase 4 commits** after the starting Phase 3 source. Each changes exactly one path, has both author and committer exactly `Madhavan <175943252+MAD1IZJOD@users.noreply.github.com>`, and was followed immediately by a normal push and actual remote-hash confirmation before the next file edit. Each commit's identity was checked after creation; the complete range is audited again at handoff.

No force push, reset, rebase, amend, historical rewrite, alternate branch/worktree, global identity change or AI attribution trailer was used. Generated artifacts remain ignored. Final release preflight and Git checks confirm a clean checkout and actual remote synchronization; the final response identifies the resulting documentation commit. Inspect the delivery with:

```powershell
git status
git log --format=fuller 046437b7e18c5fcf4b4d7e76e79ad6b067e7b0ab..HEAD
git ls-remote origin refs/heads/main
```
