import { z } from "zod";
import { locationSchema, moneySchema, productSchema } from "../domain";

export const capabilityNames = ["catalogSearch", "productDetails", "locationAvailability", "livePricing", "basketQuote", "checkout", "ordering", "deliveryEstimate"] as const;
export type CapabilityName = typeof capabilityNames[number];
export type Capability =
  | { state: "SUPPORTED_AUTHORIZED"; scope: "SIMULATION" | "APPROVED_PROVIDER"; evidence: string }
  | { state: "UNSUPPORTED" | "REQUIRES_CREDENTIALS" | "REQUIRES_COMMERCIAL_APPROVAL" | "TEMPORARILY_UNAVAILABLE"; reason: string };
export type Capabilities = Record<CapabilityName, Capability>;
export type IntegrationStatus = "AUTHORIZED_ACCESS_AVAILABLE" | "OFFICIAL_ACCESS_REQUIRES_APPROVAL" | "RESEARCH_REQUIRED" | "UNSUPPORTED" | "DEMO_ONLY";
export const priceContextSchema = z.enum(["CATALOG_PRICE", "LOCATION_PRICE", "BASKET_ESTIMATE", "CHECKOUT_QUOTE"]);
export type PriceContext = z.infer<typeof priceContextSchema>;
export const sourceTypeSchema = z.enum(["DEMO", "SIMULATED_AUTHORIZED", "AUTHORIZED_API"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const deliveryContextSchema = z.object({
  country: z.literal("IN"), pin: z.string().regex(/^[1-9]\d{5}$/).nullable(),
  areaId: z.string().min(1).max(80).nullable(), demoArea: locationSchema.nullable(),
}).strict().refine(l => l.pin !== null || l.areaId !== null || l.demoArea !== null, "Choose a service area or enter a PIN code");
export type DeliveryContext = z.infer<typeof deliveryContextSchema>;
export const serviceabilitySchema = z.object({
  status: z.enum(["available", "unavailable", "uncertain", "requires_exact_address", "unknown"]),
  locationKey: z.string(), providerId: z.string(), explanation: z.string(),
  itemEligibilityConfirmed: z.boolean(),
}).strict();
export type Serviceability = z.infer<typeof serviceabilitySchema>;

const productIdentitySchema = productSchema.omit({ available: true, location: true, updatedAt: true, source: true });
export const offerSchema = z.object({
  id: z.string().min(1).max(200), canonicalProductId: z.string().min(1).max(200),
  product: productIdentitySchema, currency: z.literal("INR"),
  stock: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
  availabilityConfidence: z.enum(["CONFIRMED", "ESTIMATED", "UNKNOWN"]),
  location: deliveryContextSchema, locationKey: z.string().min(1),
  context: priceContextSchema, sourceId: z.string().min(1), sourceType: sourceTypeSchema,
  collectedAt: z.iso.datetime(), verifiedAt: z.iso.datetime().nullable(), expiresAt: z.iso.datetime().nullable(),
  productUrl: z.url().nullable(), tax: z.enum(["INCLUDED", "EXCLUDED", "UNKNOWN"]),
  restrictions: z.array(z.string().max(200)).max(20), membership: z.string().max(80).nullable(),
  eligible: z.boolean(), conditionsKey: z.string().min(1).max(120),
}).strict().superRefine((o, ctx) => {
  const p = o.product;
  if (o.id !== p.id || !p.retailerId || !p.retailerProductId) ctx.addIssue({ code: "custom", message: "Offer identity must match the normalized retailer product identity" });
  const scale = p.packageUnit === "kg" || p.packageUnit === "L" ? 1000 : 1;
  const unit = p.packageUnit === "kg" ? "g" : p.packageUnit === "L" ? "ml" : p.packageUnit;
  if (p.canonicalQuantity !== p.packageQuantity * p.packageCount * scale || p.canonicalUnit !== unit ||
    p.unitPrice.paise !== p.price || p.unitPrice.perQuantity !== p.canonicalQuantity || p.unitPrice.unit !== p.canonicalUnit) {
    ctx.addIssue({ code: "custom", message: "Package normalization and exact unit price must agree" });
  }
  if (o.productUrl && (!o.productUrl.startsWith("https://") || new URL(o.productUrl).username || new URL(o.productUrl).password)) {
    ctx.addIssue({ code: "custom", message: "Product URL must be credential-free HTTPS" });
  }
  if (o.verifiedAt && Date.parse(o.verifiedAt) > Date.parse(o.collectedAt)) ctx.addIssue({ code: "custom", message: "Verification cannot follow collection" });
});
export type Offer = z.infer<typeof offerSchema>;

export const errorCodes = ["UNSUPPORTED", "CREDENTIALS_REQUIRED", "APPROVAL_REQUIRED", "AUTHENTICATION", "INVALID_RESPONSE", "INVALID_INPUT", "TIMEOUT", "RATE_LIMITED", "UNAVAILABLE", "LOCATION_UNSUPPORTED", "MISSING_FEES", "EXPIRED"] as const;
export type ProviderErrorCode = typeof errorCodes[number];
export type ProviderFailure = { code: ProviderErrorCode; message: string; retryable: boolean; retryAfterMs?: number };
export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: ProviderFailure };
export function failure<T = never>(code: ProviderErrorCode, retryable = false, retryAfterMs?: number): ProviderResult<T> {
  // Only fixed messages cross the server boundary. Never forward upstream text, URLs or tokens.
  return { ok: false, error: { code, message: `Provider operation unavailable (${code.toLowerCase().replaceAll("_", " ")}).`, retryable, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } };
}
export function capabilityFailure(capability: Capability): ProviderResult<never> | null {
  if (capability.state === "SUPPORTED_AUTHORIZED") return null;
  return failure(capability.state === "REQUIRES_CREDENTIALS" ? "CREDENTIALS_REQUIRED" : capability.state === "REQUIRES_COMMERCIAL_APPROVAL" ? "APPROVAL_REQUIRED" : capability.state === "TEMPORARILY_UNAVAILABLE" ? "UNAVAILABLE" : "UNSUPPORTED");
}

export const quoteLineSchema = z.object({ productId: z.string(), packs: z.number().int().min(1).max(1_000_000), unitPrice: moneySchema, total: moneySchema }).strict();
const chargeSchema = z.object({ label: z.string().min(1).max(80), amount: moneySchema }).strict();
export const basketQuoteSchema = z.object({
  id: z.string().min(1), providerId: z.string().min(1), fingerprint: z.string().min(1),
  locationKey: z.string(), currency: z.literal("INR"), conditionsKey: z.string(),
  sourceType: sourceTypeSchema, context: z.enum(["BASKET_ESTIMATE", "CHECKOUT_QUOTE"]),
  status: z.enum(["COMPLETE", "INCOMPLETE"]),
  amountMode: z.enum(["FINAL_INCLUSIVE", "COMPONENTS_EXCLUSIVE"]),
  lines: z.array(quoteLineSchema).min(1).max(12), itemSubtotal: moneySchema,
  charges: z.array(chargeSchema).max(20).nullable(), discount: moneySchema,
  discountEligible: z.boolean(), tax: z.enum(["INCLUDED", "EXCLUDED", "UNKNOWN"]),
  finalPayable: moneySchema.nullable(), issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).strict().superRefine((q, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (q.lines.some(l => l.total !== l.unitPrice * l.packs) || q.itemSubtotal !== q.lines.reduce((s, l) => s + l.total, 0)) invalid("Quote lines must reconcile exactly");
  if (new Set(q.lines.map(l => l.productId)).size !== q.lines.length) invalid("Quote product lines must be grouped");
  if (q.discount && !q.discountEligible) invalid("Discount eligibility must be confirmed");
  if (new Set(q.charges?.map(c => c.label)).size !== (q.charges?.length ?? 0)) invalid("Duplicate charge labels");
  if (Date.parse(q.expiresAt) <= Date.parse(q.issuedAt)) invalid("Quote expiry must follow issue time");
  if (q.status === "COMPLETE") {
    if (q.charges === null || q.finalPayable === null || q.tax !== "INCLUDED") invalid("Complete quotes need known inclusive fees and taxes");
    else if (q.itemSubtotal + q.charges.reduce((s, c) => s + c.amount, 0) - q.discount !== q.finalPayable) invalid("Final payable must reconcile; never add fees twice");
  } else if (q.finalPayable !== null) invalid("Incomplete quotes cannot claim a final payable");
});
export type BasketQuote = z.infer<typeof basketQuoteSchema>;
export type QuoteRequest = { location: DeliveryContext; conditionsKey: string; lines: { offerId: string; packs: number }[] };
export type CatalogPage = { offers: Offer[]; complete: boolean; warnings: ProviderFailure[] };
export type ProviderHealth = { status: "HEALTHY" | "DEGRADED" | "DISABLED"; checkedAt: string; code?: ProviderErrorCode };

export interface CommerceProvider {
  readonly id: string;
  getCapabilities(): Capabilities;
  getProviderHealth(): Promise<ProviderHealth>;
  searchProducts(query: string, location: DeliveryContext): Promise<ProviderResult<CatalogPage>>;
  getProductDetails(productId: string, location: DeliveryContext): Promise<ProviderResult<Offer>>;
  getLocationAvailability(location: DeliveryContext): Promise<ProviderResult<Serviceability>>;
  getCatalogOffers(location: DeliveryContext): Promise<ProviderResult<CatalogPage>>;
  getBasketQuote(request: QuoteRequest): Promise<ProviderResult<BasketQuote>>;
}

export const simulationSchema = z.enum(["normal", "stale", "expired", "timeout", "partial", "missing-fees"]);
export type Simulation = z.infer<typeof simulationSchema>;
export type MatchConfidence = "EXACT" | "STRONG_EQUIVALENT" | "POSSIBLE_ALTERNATIVE" | "INCOMPATIBLE";
export function matchConfidence(classification: "exact" | "equivalent" | "similar" | "rejected"): MatchConfidence {
  return classification === "exact" ? "EXACT" : classification === "equivalent" ? "STRONG_EQUIVALENT" : classification === "similar" ? "POSSIBLE_ALTERNATIVE" : "INCOMPATIBLE";
}
