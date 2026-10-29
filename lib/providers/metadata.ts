import type { BasketQuote, Capabilities, PriceContext, ProviderHealth, Serviceability, SourceType } from "./contracts";
import type { Freshness, FreshnessStatus } from "./freshness";

export type ProviderDiagnostic = { id: string; name: string; enabled: boolean; serviceability: Serviceability | null; health: ProviderHealth; capabilities: Capabilities; issue: string | null };
export type OfferDiagnostic = { sourceId: string; sourceType: SourceType; context: PriceContext; freshness: Freshness; verification: "UNAVAILABLE" | "PROVIDER_VERIFIED" };
export type PricingDiagnostics = {
  mode: "DEMO DATA" | "LIVE DATA" | "PARTIAL LIVE DATA";
  context: "BASKET_ESTIMATE" | "CHECKOUT_QUOTE";
  comparisonComplete: boolean; current: boolean; freshness: FreshnessStatus;
  generatedAt: string; expiresAt: string | null; locationKey: string;
  providers: ProviderDiagnostic[]; offers: Record<string, OfferDiagnostic>;
  quotes: BasketQuote[]; issues: string[];
  optimality: "MODEL_PROVEN" | "MODEL_BOUNDED" | "REPRICED_CANDIDATES_ONLY";
  estimatedSavings: boolean;
};
