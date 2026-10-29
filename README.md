# PureWorth

**One shopping list. Every store. The lowest total price.**

A working grocery comparison MVP for India, built with Next.js App Router, strict TypeScript, React, Zod, Lucide and custom responsive CSS. It runs without paid APIs, a database, credentials or environment variables.

**All stores, prices, offers and availability are fictional demonstration fixtures.** Freshlane, Daily Basket and Pantry Club are simulated retailers. Blinkit, Zepto, Swiggy Instamart, BigBasket, Amazon and Flipkart are not integrated. Checkout is a preview: it cannot take payments or place orders.

## Run locally

Use Node.js 24 (verified with 24.18.0) and npm. From PowerShell:

```powershell
Set-Location 'D:\personal projects\PureWorth'
npm ci --ignore-scripts
npm run dev
```

Open [PureWorth locally](http://127.0.0.1:3000). For production mode:

```powershell
npm run build
npm run start
```

The server binds to loopback. Set a different port with `npm run dev -- --port 3001`. The application needs the Node.js server for `/api/compare`; a static-only export will not run comparisons.

## What works

- A responsive landing page with natural-language input, original grocery illustrations and a working example.
- Adding multiple items, adding individual items, editing canonical package quantities and brand preferences, changing pack counts, and removing items.
- Three illustrative service areas with different availability: Bengaluru, Pune and Hyderabad.
- Deterministic exact, equivalent and similar matching. Alternatives require individual approval; approvals reset when list or preferences change.
- Actual server-side complete-basket optimization, the cheapest feasible single-store option, and a fewer-deliveries strategy with a configurable extra budget.
- Retailer exclusions and a maximum of one, two or three orders.
- Item allocations, normalized unit prices, store subtotals, delivery, handling, platform and small-order fees, confirmed demo discounts, and a final payable total.
- A valid single-store savings reference, or no savings claim when that reference is unavailable.
- Grouped smart carts, explanations of free-delivery thresholds, downloadable text shopping plans and a clearly disabled checkout preview.
- Loading, empty, invalid-input, missing-product and failed-request states; keyboard navigation, native dialog focus/escape behavior and reduced-motion support.

Try the weekly essentials example, select **Compare my list**, review matches, then select **Find my best basket**. The verified default example returns **₹1,039 across two stores**. The cheapest single-store basket is **₹1,055 at Freshlane**, a valid **₹16** reference saving. With the default ₹20 tolerance, the fewer-deliveries strategy selects that ₹1,055 single-store basket. These are fixture results, not real shopping quotes.

## Architecture

| Area | Source | Responsibility |
| --- | --- | --- |
| Domain | `lib/domain.ts` | Strict Zod schemas, integer paise, quantities, products and result contracts |
| Data | `lib/catalog.ts` | Async retailer adapter interface and 42 validated fictional offers per service area |
| Matching | `lib/matching.ts` | Text parsing, exact unit normalization, package matching and approval requirements |
| Optimization | `lib/optimizer.ts` | Deterministic allocation search and order-level fee evaluation |
| API | `app/api/compare/route.ts` | Bounded JSON input, validation, trusted demo data and server-side computation |
| Experience | `components/` | List editing, match review, preferences, results, cart and checkout preview |
| Styling | `app/globals.css` | Self-contained responsive styles and reduced-motion behavior |

The frontend submits requests and approved match IDs, not product prices or fee calculations. The server obtains those from the adapter. React escapes user text. The API rejects unknown fields and unsupported stores/locations, enforces unique item IDs, limits bodies to 32 KB while reading, and disables response caching. Browser security headers restrict framing and unused device/payment capabilities. No external LLM is involved.

Supabase is intentionally deferred: there is no account or durable shopping-history requirement in this MVP. Lists live in the current page's memory and reset on reload. Do not put secrets in source files; `.env*` files are ignored for future authorized integrations.

## Matching and quantity semantics

Supported input includes `2 litres milk, 5kg rice, 1kg dal, 12 eggs`, `0.5 kg rice`, and `2 x 1 L Amul milk`. Commas, semicolons, newlines and the word “and” separate items. Quantities normalize to integer grams, millilitres, pieces or packs without floating-point rounding. Grams/kg, ml/L, pieces and packs remain distinct dimensions.

The compact demo vocabulary covers milk, rice, dal, oil, eggs, atta, sugar, tea, curd and bananas. When omitted, the parser uses reviewable standard sizes (for example 1 L milk, 5 kg basmati rice and 12 regular eggs) and known grocery variants. This is a deterministic demo parser, not general language understanding. Unknown products remain unavailable; unknown qualifiers constrain matches rather than silently disappearing.

An exact match meets the interpreted brand, variant and package request. An equivalent match fulfills the exact total with a changed package arrangement. A similar alternative differs in brand or variant. Both latter classes need explicit approval. A single 1 kg rice pack never fulfills 5 kg: the engine must allocate five packs, display that quantity, calculate five prices, and receive approval for the package change. Indivisible or oversized packages and incompatible units are rejected. Inner pack counts are included in canonical quantity (the egg fixture is two inner packs of six).

## Optimization algorithm and limits

Money stays in integer paise. Percentage discounts use BigInt ratios with half-up rounding to the nearest paise. Rupee division is only used for display; displayed normalized unit prices are rounded presentation of an exact price/quantity ratio.

1. Filter to available products, selected retailers and exact/explicitly approved matches.
2. Seed feasible complete single-store allocations.
3. Enumerate complete allocations with deterministic ordering, rejecting branches that exceed the selected store count.
4. At a complete allocation, group the lines per retailer and compute each order's charges **once**, after subtotaling all its items.
5. Reject orders below minimum spend, apply delivery thresholds, handling/platform/other charges, small-order fees and eligible confirmed discounts.
6. Keep the best complete basket for each retailer count. Compare total first, then fewer orders, then stable match IDs.
7. Select the cheapest basket and the fewest-orders candidate within the user's absolute paise tolerance.

Delivery thresholds, offer eligibility and order minima use **pre-discount merchandise subtotal** in the demo fee model. Discounts apply only to merchandise, never exceed the subtotal or configured cap, and must be confirmed. Item prices are illustrative tax-inclusive amounts; live tax/fee semantics require provider-specific normalization.

There is deliberately no item-price-only pruning: a higher merchandise subtotal can unlock free delivery or a discount. The adversarial regression verifies ₹160 at Store A beats greedy ₹170 at Store B after delivery.

The MVP accepts **1–12 list lines**, **1–20 requested packs per line**, a base quantity of **1–50,000 canonical units**, and **up to 3 fictional retailers**. Search has a shared **200,000-node cap**, including single-store seeding. Runtime is exponential in the number of eligible choices; the node cap bounds search work, not wall-clock duration. A 12-line test exercises the actual cap. On reaching it, the UI says **best found**, and neither optimality nor infeasibility is claimed. An exhaustive result is globally optimal **within the supplied eligible catalog and restrictions**. No partial list is represented as a complete basket.

The reference is the cheapest eligible single-store basket found in the same search. A bounded search explicitly calls it “best found.” If none exists, savings are null. The engine does not optimize coupons needing an account, delivery time slots, inventory quantities, overlapping promotions or unknown fees.

One line uses a single retailer SKU with an integer pack count. It cannot combine several different package sizes or split the same requested line between retailers. The optimizer never adds extra unrequested goods to cross a delivery threshold. A future larger catalog should move search into a worker/queue and consider an exact solver or stronger admissible bounds, retaining honest best-found reporting.

## Verification

Executed locally on 29 October 2026:

| Check | Actual result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 64 tests passed across 3 files |
| `npm run build` | Passed; static landing page and dynamic comparison API generated |
| `npm run test:e2e` | 27 tests passed on production server in about 1.1 minutes |
| `npm audit --omit=dev` | 0 known vulnerabilities reported |

Tests cover per-order fees, free-delivery boundaries, minimum orders, discounts, rounding, missing inventory, infeasible baskets, deterministic ties, store limits, quantity changes, package equivalence, approval, parser validation, the greedy adversarial case, and an independent exhaustive oracle across 40 fee scenarios. The actual 200,000-node limit is exercised.

Playwright tests Chromium at desktop (1440 px), tablet (820 px) and emulated iPhone (390 px) sizes. They also run the complete journey at 320 px with reduced motion. Tests verify the real API, strategy switching, quantities/brands/removal, substitution rejection and approval, location/store restrictions, request failure and retry, exported plan content, dialog closing and disabled ordering. No horizontal overflow was observed at the tested sizes. These are browser emulations, not physical-device or Safari/Firefox verification.

Automated axe scans use WCAG 2 A/AA, 2.1 AA and 2.2 AA tags on landing, match review, results and checkout at all three viewport sizes, with no reported violations in the final run. Finite entrance animations settle before scans. This is useful automated coverage, not a blanket accessibility certification.

To repeat browser checks:

```powershell
npx playwright install chromium
npm run build
npm run test:e2e
```

Playwright starts and stops a production server when port 3000 is free. If a server is already there, it reuses it locally; ensure it is this app's **latest production build**. Reports and screenshots are generated in ignored `playwright-report/` and `test-results/`. Open the HTML report with `npx playwright show-report`.

## Deployment and live integrations

The app is Vercel-ready through standard Next.js detection: import this repository, use Node.js 24, `npm ci --ignore-scripts`, and `npm run build`. Keep the comparison route on the Node.js runtime. No Vercel deployment has been performed or claimed.

Before public production use, add deployment-level rate limiting/abuse controls, operational monitoring, durable quote/freshness handling, privacy and retention policies, provider contract tests, broader browser/device checks and load tests. The API's input/search limits are not a replacement for a production rate limiter. Request aborts in the browser do not interrupt synchronous server enumeration.

See [the integration research and authorized-provider requirements](docs/integrations.md). Live checkout additionally needs fresh retailer quotes, explicit final consent, authorized ordering interfaces, idempotency, reconciliation, customer support and a compliant payment provider. Public product-search access alone does not establish order-placement rights.

## Repository workflow

Implementation remains on `main` in the requested directory. Every persistent file change is individually reviewed, staged, committed with the configured Madhavan identity, author/committer-verified, pushed immediately, and checked against `origin/main` before another file is changed. Generated files are ignored. No history was rewritten. Use `git log --format=fuller` and `git status` to inspect the delivered state.
