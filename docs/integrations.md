# Authorized integration plan

Research checked on 29 October 2026. No live provider access was configured or tested. The only implemented adapter is the fictional demonstration adapter.

## Findings from primary sources

| Provider/path | Documented option | Implication for PureWorth |
| --- | --- | --- |
| Blinkit | [Official terms](https://blinkit.com/terms) restrict collection/use of product listings and prices and use of data-mining/robot tools under the ordinary platform license. | Obtain a written commercial integration agreement before collecting catalog or quote data. No scraping adapter is included. |
| Amazon India | [Creators API introduction](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction) describes catalog access for affiliate partners. The [India deprecation notice](https://affiliate-program.amazon.in/creatorsapi/docs/en-us/paapiv5-deprecation) says PA-API 5 is deprecated in favor of Creators API. [Onboarding](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api) requires an accepted Associates account before API registration. | Evaluate current eligibility, India marketplace support, display/caching/price-freshness rules and credentials. Catalog authorization must not be treated as checkout authorization. No Amazon ordering integration has been established. |
| Flipkart | [Official Affiliate API overview](https://affiliate.flipkart.com/api-docs/af_overview.html) documents product feeds, product information/search and offer data for registered affiliate users. | Confirm current enrollment/access and permitted comparison use directly. The documentation does not establish a PureWorth customer checkout integration. No keys, searches or orders were tested. |
| ONDC | [Buyer network participant overview](https://ondc.org/pages/buyer-network-participants.html) describes buyer applications, catalog aggregation, multi-seller carts and buyer-facing support responsibilities. [Technology resources](https://resources.ondc.org/tech-resources) and the [official onboarding guide](https://github.com/ONDC-Official/developer-docs/blob/main/registry/Onboarding%20of%20Participants.md) provide onboarding entry points. | Investigate joining as a Buyer Network Participant or working with an authorized technology provider. Actual reachable sellers depend on domain, service area and network participation. ONDC is not proof that Blinkit, Zepto or any other named retailer is reachable. |
| Zepto, Swiggy Instamart, BigBasket | No authorized commercial access, credentials or documented buyer checkout contract was established during this implementation. | Contact the providers or an authorized data partner. This is a limit of the research/access available here, not a claim that provider partnerships or private APIs do not exist. |

These findings are integration planning, not a legal determination. Recheck provider terms, access programs and technical contracts before implementation. The application never presents fictional prices under real retailer names.

## Adapter contract

`RetailerAdapter` in `lib/catalog.ts` exposes:

- `mode` and `orderingSupported` as explicit declarations;
- `search(query, location)` and `getProduct(id, location)`;
- normalized `getPrices` and `getAvailability` results;
- service-area `getRetailers` and `getFeeRules`;
- `freshness()` with source, fixture timestamp and live/demo status.

The demo adapter implements every method. It does not expose an order method. A later authorized ordering adapter must be a separate capability with provider-specific contracts, not a flag that turns a catalog search into purchasing.

A live catalog adapter should supply provider IDs, canonical IDs, brand/category/variant/quality information, complete package and inner-pack quantities, exact paise prices, stock, service area, provenance, quote identifiers, observed timestamps and expiry. Validate the normalized output at the boundary. Preserve raw quote evidence securely for reconciliation. Authentication belongs in server environment variables or an appropriate secret manager.

The API currently obtains all demo products through the adapter. Its catalog is intentionally tiny. A live implementation needs provider search, pagination and server caching with explicit freshness rules; it must not fetch an entire retail catalog for every basket.

## Fee and quote requirements

Before describing a live result as final payable, obtain a location- and basket-specific quote confirming:

- merchandise prices and exact inventory/quantity limits;
- minimum order restrictions and whether thresholds use pre- or post-discount merchandise values;
- delivery, handling, platform, small-order, packaging, taxes and other mandatory charges;
- account, membership, payment-method and coupon eligibility;
- quote expiration, fulfillment slots and whether separate sellers create separate orders.

Only confirmed, eligible discounts belong in optimization. The current model supports fixed and basis-point merchandise discounts with a minimum and cap, and fixed/threshold order fees. It cannot represent every real provider rule. Extend the fee contract and add adversarial tests when a provider introduces tax-dependent fees, stacked offers, membership benefits or complex shipping rules. Never insert an unknown fee as zero merely to produce a total.

## ONDC investigation path

1. Establish the relevant retail domain, buyer role, operating responsibilities and reachable service areas with ONDC or an approved technology provider.
2. Complete current participant onboarding, identity/signature and registry requirements from the official developer guides.
3. Integrate asynchronous discovery/catalog responses and transaction quote/selection flows in the appropriate supported protocol version.
4. Implement customer consent, quote expiry, failures, cancellations, refunds, support and reconciliation before enabling a transaction flow.
5. Validate in the permitted sandbox and complete required certification/onboarding before production traffic.

This is a proposed work sequence, not a tested ONDC implementation or assurance of any retailer's participation. The demo does not use ONDC data.

## Ordering and payment gates

Keep ordering unavailable until authorized interfaces exist and are tested. Required work includes fresh quote confirmation, explicit user approval of every selected product/substitution/charge, secure customer address handling, provider order idempotency, inventory reservation semantics, failure recovery, cancellation/refund handling and customer support.

A payment provider must handle payment credentials and applicable processing requirements. PureWorth must reconcile multiple seller orders and partial failures before promising a unified checkout. Do not collect card data in this MVP. Do not automate logged-in consumer accounts, bypass CAPTCHAs or bot controls, or imply that a checkout preview has placed an external order.

## Operational work before a public live release

Add rate limits and abuse controls, durable quote caching/expiry, account consent and privacy/retention policies where needed, request telemetry with sensitive-data redaction, timeouts/retries/circuit breakers, provider contract tests, health checks and alerting. Move expensive searches off the synchronous API path if traffic or catalog growth demands it. Add broader browser/physical-device and load testing. Existing body and search limits bound individual requests but do not protect against aggregate traffic abuse.
