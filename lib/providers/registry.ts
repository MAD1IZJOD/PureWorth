import { capabilityNames, capabilityFailure, failure, type BasketQuote, type Capabilities, type Capability, type CatalogPage, type CommerceProvider, type IntegrationStatus, type Offer, type ProviderHealth, type ProviderResult, type Serviceability, type SourceType } from "./contracts";

export type ProviderDefinition = {
  id: string; name: string; integrationStatus: IntegrationStatus; sourceType: SourceType;
  credentialsRequired: boolean; featureEnabled: boolean; locationSupport: "DEMO_AREA" | "UNVERIFIED";
  quoteSupport: "SIMULATED" | "UNVERIFIED"; health: "SIMULATED" | "DISABLED"; capabilities: Capabilities;
};

export function demoCapabilities(): Capabilities {
  return Object.fromEntries(capabilityNames.map(name => [name,
    ["checkout", "ordering", "deliveryEstimate", "livePricing"].includes(name)
      ? { state: "UNSUPPORTED", reason: "Simulation has no real pricing, delivery promise, payment or ordering" }
      : { state: "SUPPORTED_AUTHORIZED", scope: "SIMULATION", evidence: "Owned fictional local fixtures; not commercial retailer authorization" },
  ])) as Capabilities;
}

function realCapabilities(id: string): Capabilities {
  return Object.fromEntries(capabilityNames.map(name => {
    const capability: Capability = ["checkout", "ordering"].includes(name)
      ? { state: "UNSUPPORTED", reason: "No ordering or payment connector is implemented" }
      : { state: id === "amazon" && ["catalogSearch", "productDetails", "livePricing"].includes(name) ? "REQUIRES_CREDENTIALS" : "REQUIRES_COMMERCIAL_APPROVAL", reason: "Not enabled: PureWorth permission, documented scope and verified credentials are required" };
    return [name, capability];
  })) as Capabilities;
}

export const providerDefinitions: readonly ProviderDefinition[] = [
  ...[["freshlane", "Freshlane"], ["daily", "Daily Basket"], ["pantry", "Pantry Club"]].map(([id, name]): ProviderDefinition => ({ id, name, integrationStatus: "DEMO_ONLY", sourceType: "SIMULATED_AUTHORIZED", credentialsRequired: false, featureEnabled: true, locationSupport: "DEMO_AREA", quoteSupport: "SIMULATED", health: "SIMULATED", capabilities: demoCapabilities() })),
  ...[["blinkit", "Blinkit", "RESEARCH_REQUIRED"], ["zepto", "Zepto", "RESEARCH_REQUIRED"], ["instamart", "Swiggy Instamart", "OFFICIAL_ACCESS_REQUIRES_APPROVAL"], ["bigbasket", "BigBasket", "RESEARCH_REQUIRED"], ["amazon", "Amazon India", "OFFICIAL_ACCESS_REQUIRES_APPROVAL"], ["flipkart", "Flipkart", "RESEARCH_REQUIRED"], ["ondc", "ONDC network", "OFFICIAL_ACCESS_REQUIRES_APPROVAL"]].map(([id, name, status]): ProviderDefinition => ({ id, name, integrationStatus: status as IntegrationStatus, sourceType: "AUTHORIZED_API", credentialsRequired: true, featureEnabled: false, locationSupport: "UNVERIFIED", quoteSupport: "UNVERIFIED", health: "DISABLED", capabilities: realCapabilities(id) })),
];

/** A flag alone cannot confer authorization. No real connector is registered today. */
export function authorizationGate(config: { enabled: boolean; approvalEvidence?: string; serverCredentialsPresent: boolean; implemented: boolean }): ProviderResult<true> {
  if (!config.enabled || !config.implemented) return failure("UNSUPPORTED");
  if (!config.approvalEvidence?.trim()) return failure("APPROVAL_REQUIRED");
  if (!config.serverCredentialsPresent) return failure("CREDENTIALS_REQUIRED");
  return { ok: true, value: true };
}

export class DisabledProvider implements CommerceProvider {
  constructor(readonly id: string) {
    if (!providerDefinitions.some(p => p.id === id && !p.featureEnabled)) throw new Error("Unknown disabled provider");
  }
  getCapabilities(): Capabilities { return realCapabilities(this.id); }
  async getProviderHealth(): Promise<ProviderHealth> { return { status: "DISABLED", checkedAt: new Date().toISOString(), code: "APPROVAL_REQUIRED" }; }
  private blocked<T>(capability: keyof Capabilities): ProviderResult<T> { return capabilityFailure(this.getCapabilities()[capability]) ?? failure("UNSUPPORTED"); }
  async searchProducts(): Promise<ProviderResult<CatalogPage>> { return this.blocked("catalogSearch"); }
  async getProductDetails(): Promise<ProviderResult<Offer>> { return this.blocked("productDetails"); }
  async getLocationAvailability(): Promise<ProviderResult<Serviceability>> { return this.blocked("locationAvailability"); }
  async getCatalogOffers(): Promise<ProviderResult<CatalogPage>> { return this.blocked("catalogSearch"); }
  async getBasketQuote(): Promise<ProviderResult<BasketQuote>> { return this.blocked("basketQuote"); }
}
