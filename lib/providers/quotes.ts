import { createHash } from "node:crypto";
import { z } from "zod";
import type { Basket, ShoppingItem, StoreOrder } from "../domain";
import { basketQuoteSchema, deliveryContextSchema, failure, type BasketQuote, type ProviderResult, type QuoteRequest, type SourceType } from "./contracts";
import { locationKey } from "./location";

export const quoteRequestSchema = z.object({
  location: deliveryContextSchema, conditionsKey: z.string().min(1).max(120),
  lines: z.array(z.object({ offerId: z.string().min(1).max(200), packs: z.number().int().min(1).max(1_000_000) }).strict()).min(1).max(12),
}).strict();

export function groupedLines(request: QuoteRequest): QuoteRequest["lines"] {
  const parsed = quoteRequestSchema.parse(request);
  const groups = new Map<string, number>();
  for (const line of parsed.lines) groups.set(line.offerId, (groups.get(line.offerId) ?? 0) + line.packs);
  if ([...groups.values()].some(packs => packs > 1_000_000)) throw new Error("Quantity limit exceeded");
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([offerId, packs]) => ({ offerId, packs }));
}
export function quoteFingerprint(request: QuoteRequest): string {
  return createHash("sha256").update(JSON.stringify([locationKey(request.location), request.conditionsKey, groupedLines(request)])).digest("hex");
}
export function requestFingerprint(items: ShoppingItem[]): string {
  return createHash("sha256").update(JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
}

export function validateQuote(raw: unknown, request: QuoteRequest, providerId: string, sourceType: SourceType, now = Date.now()): ProviderResult<BasketQuote> {
  const parsed = basketQuoteSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_RESPONSE");
  const quote = parsed.data;
  if (quote.providerId !== providerId || quote.sourceType !== sourceType || quote.locationKey !== locationKey(request.location) || quote.conditionsKey !== request.conditionsKey || quote.fingerprint !== quoteFingerprint(request) ||
    JSON.stringify(quote.lines.map(l => ({ offerId: l.productId, packs: l.packs })).sort((a, b) => a.offerId.localeCompare(b.offerId))) !== JSON.stringify(groupedLines(request)) || Date.parse(quote.issuedAt) > now) return failure("INVALID_RESPONSE");
  if (Date.parse(quote.expiresAt) <= now) return failure("EXPIRED");
  if (quote.status !== "COMPLETE" || quote.charges === null || quote.finalPayable === null) return failure("MISSING_FEES");
  return { ok: true, value: quote };
}

/** A final inclusive amount is authoritative; do not add its fee components again. */
export function applyQuote(order: StoreOrder, quote: BasketQuote): StoreOrder {
  const lines = order.lines.map(line => {
    const quoted = quote.lines.find(q => q.productId === line.product.id);
    if (!quoted) throw new Error("Missing quoted product");
    return { ...line, product: { ...line.product, price: quoted.unitPrice, unitPrice: { ...line.product.unitPrice, paise: quoted.unitPrice } }, lineTotal: quoted.unitPrice * line.packs };
  });
  if (quote.status !== "COMPLETE" || quote.finalPayable === null || quote.charges === null) throw new Error("Incomplete order quote");
  return { ...order, lines, subtotal: quote.itemSubtotal, charges: quote.charges, discount: quote.discount, total: quote.finalPayable };
}

export type SavingsEvidence = {
  total: number; complete: boolean; current: boolean; requestKey: string; locationKey: string;
  conditionsKey: string; productSignature: string; sourceTypes: SourceType[]; context: "BASKET_ESTIMATE" | "CHECKOUT_QUOTE";
};
export function basketSignature(basket: Basket): string {
  return JSON.stringify(basket.orders.flatMap(o => o.lines).map(l => [l.itemId, l.product.category, l.product.brand, l.product.variant, l.product.canonicalUnit, l.product.canonicalQuantity * l.packs]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
export function comparableSavings(selected: SavingsEvidence, reference: SavingsEvidence | null): { amount: number; estimated: boolean } | null {
  if (!reference || !selected.complete || !reference.complete || !selected.current || !reference.current || !Number.isSafeInteger(selected.total) || !Number.isSafeInteger(reference.total) || selected.total < 0 || reference.total < 0) return null;
  for (const key of ["requestKey", "locationKey", "conditionsKey", "productSignature", "context"] as const) if (selected[key] !== reference[key]) return null;
  const sources = [...selected.sourceTypes, ...reference.sourceTypes];
  if (!sources.length || (sources.includes("AUTHORIZED_API") && sources.some(s => s !== "AUTHORIZED_API"))) return null;
  return { amount: reference.total - selected.total, estimated: selected.context !== "CHECKOUT_QUOTE" || sources.some(s => s !== "AUTHORIZED_API") };
}
