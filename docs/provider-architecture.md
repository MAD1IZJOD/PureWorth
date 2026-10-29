# Phase 3 commerce infrastructure

PureWorth still runs entirely locally without credentials. Its only enabled providers are fictional Freshlane, Daily Basket and Pantry Club. The reference transport simulates an authorized commerce response contract; it does **not** simulate approval from a real company. See [the integration matrix](retailer-integration-matrix.md) for current official research and external access blockers.

## Execution path

`POST /api/compare` validates origin, content type, a 32 KB streamed body, six-digit PIN format, list and preference schemas. A process-local budget admits at most 120 requests per minute and eight concurrent requests. Stalled bodies are cancelled after five seconds. The route calls `compareDemo`, which binds the three reference providers to the generic `compareProviders` service.

The service checks capabilities and explicit serviceability, validates normalized offers, applies freshness/eligibility filters, calls the existing matcher and optimizer, then requests full allocated order quotes for the three returned strategies. Repeated identical order requests within one comparison share a promise. Only complete, reconciled, unexpired quotes become payable estimates. Missing fees are never replaced by zero. A provider outage may yield an explicitly incomplete best-found comparison from other available data; savings are withheld.

The old catalog adapter remains available for compatibility and deterministic fixtures. The UI's comparison API now uses the reference connector. No external HTTP connector is registered, and no scraping, personal-account session access, payment or order placement exists.

## Module map

| File under `lib/providers/` | Responsibility |
| --- | --- |
| `contracts.ts` | Capability states, discriminated success/failure, normalized offer and basket quote schemas, stock confidence, provenance, price context, tax and purchase conditions |
| `registry.ts` | Public provider metadata, disabled real-provider operations, explicit authorization gate and simulation-only grants |
| `location.ts` | Validated location contexts, exact location keys, illustrative PIN/area coverage |
| `freshness.ts` | Configurable provider/context policies and FRESH, AGING, STALE, EXPIRED, UNKNOWN states |
| `cache.ts` | Cache interface, permission-bounded process-local LRU, dimensions, expiry and invalidation |
| `reliability.ts` | Response validation, abort deadlines, bounded retries/backoff, rate and concurrency limits, sanitized diagnostics, endpoint declaration guard |
| `reference.ts` | Complete connector over an injectable simulated transport; search, details, coverage, offers, quotes and health |
| `quotes.ts` | Canonical request fingerprints, exact quote reconciliation, authoritative final amounts and comparable savings evidence |
| `service.ts` | Provider-independent normalization/matching/optimization/repricing orchestration and enabled demo bindings |
| `metadata.ts` | Public comparison diagnostics consumed by the interface |

## Offer contract and matching

An offer has a stable provider-qualified identity, canonical product ID, provider product ID, brand/category/variant, original package quantity/unit/count and normalized grams, millilitres, pieces or packs. Integer paise represent INR. Unit prices are exact rational values (`paise / perQuantity`); displayed unit prices use the existing integer rounding helper. Package normalization and unit-price ratios must reconcile. Offer and normalized product identities agree so allocation cannot quote another SKU accidentally.

Stock is IN_STOCK, OUT_OF_STOCK or UNKNOWN with separate confidence. Context distinguishes CATALOG_PRICE, LOCATION_PRICE, BASKET_ESTIMATE and CHECKOUT_QUOTE. Location, source ID/type, collection/verification/expiry timestamps, tax inclusion, restrictions, membership, eligibility and conditions are explicit. Source collection time is not a retailer price verification. Demo snapshots keep the authored 1 October 2026 fixture identifier and a null `verifiedAt`.

The matcher preserves decimal quantities, brand boundaries, variant constraints, exact requested quantities and explicit approval for all package/product alternatives. Confidence is EXACT, STRONG_EQUIVALENT, POSSIBLE_ALTERNATIVE or INCOMPATIBLE. Confidence describes product compatibility, not price freshness. Real offers with unsupported restrictions, membership requirements, unknown tax or unknown stock confidence are conservatively excluded until their connector implements eligibility safely.

## Location and freshness

Location keys include country, exact PIN, explicit area and demo area; no nearby store is inferred. Supported illustrative PINs are 560001/Bengaluru, 411001/Pune and 500001/Hyderabad. A different known fixture PIN is unavailable for the selected area; any other valid PIN is uncertain. Clear the PIN to use the selected fictional area. These fixtures do not prove real address or item serviceability. Contracts also support unknown and requires-exact-address responses. Precise addresses are not collected.

For local simulated snapshots only, fresh is under 60 seconds, aging under 120 seconds, stale from 120 seconds and expired at five minutes or an earlier source expiry. These thresholds are illustrative and configurable, not retailer policies. Real providers have no default TTL or verification policy. Without a policy and meaningful verification, freshness is UNKNOWN. Future timestamps are not treated as fresh. Stale, expired and unknown offers cannot enter a current optimization.

The UI measures elapsed time against the server snapshot, so a device wall-clock offset does not immediately invalidate fresh responses. Staleness/expiry closes an open checkout preview, disables preview/export and removes savings. Refresh requests a new comparison and invalidates the relevant normal-demo catalog cache. This browser guard is presentation support; server-side quote validation remains authoritative.

## Cache and quote lifecycle

Cache keys include provider, product/query, exact location, price context, INR and purchase conditions. Entries are cloned, bounded by capacity and size, and rejected without retention permission/evidence. The shorter of requested TTL, permitted TTL and source expiry applies. Reads do not extend expiry. Credential-like fields are rejected; only normalized public catalog DTOs belong in this cache. Explicit invalidation supports location, provider, product and other dimensions.

Normal demo providers share a bounded 20-entry cache each, with a 30-second illustrative retention policy. Fault-simulation providers have separate instances; they cannot contaminate normal snapshots. Real-provider caching defaults to off. Process restarts discard caches. No private credentials or shopping lists are stored in the price cache.

Basket quotes are not shared across HTTP requests. Product/quantity allocation is grouped by provider; a SHA-256 fingerprint covers sorted product IDs/counts, exact location and conditions. Any quantity, substitution, allocation, location or conditions change requires a different quote. List/preference changes discard the old UI comparison; substitution approval discards quote diagnostics and requires optimization again. Every comparison obtains new allocated-order quotes, even when catalog data is cached.

Complete quotes require known inclusive tax, item lines/subtotal, individually labeled order fees, confirmed discount eligibility, final payable and expiry. Both FINAL_INCLUSIVE and COMPONENTS_EXCLUSIVE contracts must reconcile to the same exact equation. Aggregation uses the final payable **once**. It never adds fee components to that final amount again. Unsupported taxes or missing fees produce an incomplete result. Earlier quote expiry is checked again after later provider calls.

## Optimality and savings limits

The original integer-paise DFS optimizer is unchanged: up to 12 list items, three stores in the public MVP and 200,000 allocation nodes, with deterministic tie-breaking, minimum orders, thresholds and confirmed demo discounts. Completed enumeration proves the optimum within the eligible normalized catalog and supplied fee model. A capped search reports best found, including a best-found reference label.

Live repricing of only three model candidates cannot prove a global optimum under an arbitrary provider fee function. Changed provider totals are therefore labeled REPRICED_CANDIDATES_ONLY and the response is bounded. A future live connector must either provide an evidenced exact fee model or use a separately bounded quote-aware search; do not claim a guaranteed final-price optimum merely because selected candidates were quoted.

Savings require complete/current baskets, identical request quantities, location, conditions, price context and compatible product signatures (brand, category, variant, units and fulfilled quantity). Mixed real and demo sources are rejected. The global reference is withheld if any displayed strategy lacks comparable evidence. All demo comparisons use estimated wording. No complete valid reference means no savings claim. Missing selected-provider catalog/coverage/quote data marks the comparison incomplete even if other providers can price a complete basket.

## Reliability and security

Provider executors validate responses and return a fixed error taxonomy. Timeout, unavailable and rate-limit errors alone may retry, at most three retries by configuration (one for the demo), with bounded exponential backoff. Retry-After is honored; a delay beyond the budget returns the failure instead of retrying early. Authentication, credentials, approval and invalid-response failures are not retried. There is no unbounded work queue. A non-cooperative timed-out transport holds its concurrency slot until it settles, preventing uncontrolled background requests.

Diagnostics accept only provider ID, operation, error code and attempt count; raw upstream messages, response bodies, PINs and secrets are not logged. The current API logs only a fixed internal failure code. Public inputs cannot specify an outbound URL, credential or real-provider enable flag. Product URLs are credential-free HTTPS metadata and are never fetched by this app.

There is no outbound HTTP transport today, so no user-controlled server fetch or SSRF path exists. `validateProviderEndpoint` is a declaration guard for exact configured HTTPS endpoints, not a complete network sandbox. Before adding HTTP, implement approved static endpoints, resolved-public-IP validation/pinning, redirect rejection, response-size limits and deployment egress controls; guard against DNS rebinding and private/metadata address ranges. Never pass browser URLs to fetch. A future transport must keep secrets server-only and honor abort signals to release sockets.

The local request/provider budgets are process-local, not distributed DDoS protection. A public multi-instance deployment needs trusted edge limits, proxy configuration and operational monitoring. No public deployment was performed. Dependency audit results and final checks are recorded in the Phase 3 delivery report; vulnerability checks are point-in-time evidence, not a security guarantee.

## Persistence decision

Durable storage is deferred. Product mappings and provider definitions are versioned fixtures/configuration; public snapshots have short local cache lifetimes; quote metadata is request-scoped; lists remain in page memory. No account, precise address, history retention or background polling is needed. Supabase/Redis would add unnecessary operational and retention obligations now. When an approved provider needs durable mappings or snapshots, add a minimal retention-reviewed repository behind these interfaces, with per-source purge/expiry and no credential/list storage by default.

## Enabling the first legitimate provider

1. Obtain approval for PureWorth's exact use, marketplace, fields, comparison display, caching, attribution and purchase conditions; record evidence without committing private agreements or secrets.
2. Verify current official documentation and working credentials in the approved environment. Select regular APIs rather than an agent dependency for deterministic shopping where applicable. ONDC needs its own buyer-participant/technology-partner onboarding and protocol operations.
3. Implement a server-only `CommerceProvider` transport using a shared `ProviderExecutor`, validated responses, approved endpoints, safe authentication and explicit serviceability. Unsupported operations return a capability failure. Read credentials only on the server; introduce placeholder environment variable names only once the selected provider's authentication is known.
4. Map to normalized offers and complete quote contracts; set source AUTHORIZED_API only for actual approved responses. Configure evidence-backed freshness, permission-bounded retention and exact tax/discount eligibility. Do not install guessed real TTLs.
5. Contract-test failures, stock/location, quantities, cache isolation, fees, quotes and savings. Review fee-model optimality limits. Configure the registry flag/capabilities only after the authorization gate passes; a flag or public documentation alone cannot authorize access.
6. Extend the public request allowlist and consumer UI for that approved provider's scope, including real provenance and required disclosures. The current browser experience intentionally remains demo-only. Perform a limited authorized live smoke test with owner consent before public use. Ordering, payments and credentials for customer accounts remain outside Phase 3.
