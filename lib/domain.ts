import { z } from "zod";

export const moneySchema = z.number().int().min(0).max(100_000_000);
export const canonicalUnitSchema = z.enum(["g", "ml", "pieces", "packs"]);
export type CanonicalUnit = z.infer<typeof canonicalUnitSchema>;
export const locationSchema = z.enum(["bengaluru", "pune", "hyderabad"]);
export type Location = z.infer<typeof locationSchema>;

export const itemSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  category: z.string().min(1).max(40),
  variant: z.string().max(50),
  brand: z.string().max(50).nullable(),
  quantity: z.number().int().min(1).max(50_000),
  unit: canonicalUnitSchema,
  count: z.number().int().min(1).max(20),
}).strict();
export type ShoppingItem = z.infer<typeof itemSchema>;

export const feeSchema = z.object({
  delivery: moneySchema,
  freeDeliveryAt: moneySchema.nullable(),
  minimumOrder: moneySchema,
  handling: moneySchema,
  platform: moneySchema,
  smallOrderBelow: moneySchema,
  smallOrderFee: moneySchema,
  other: moneySchema,
  discount: z.object({
    label: z.string(), minimum: moneySchema, fixed: moneySchema,
    basisPoints: z.number().int().min(0).max(10_000), cap: moneySchema,
    confirmed: z.boolean(),
  }).nullable(),
});
export type FeeRules = z.infer<typeof feeSchema>;
export type Retailer = { id: string; name: string; initials: string; color: string; fees: FeeRules };

export const productSchema = z.object({
  id: z.string(), retailerProductId: z.string(), retailerId: z.string(),
  name: z.string(), brand: z.string(), category: z.string(), variant: z.string(),
  packageQuantity: z.number().int().positive(),
  packageUnit: z.enum(["g", "kg", "ml", "L", "pieces", "packs"]),
  packageCount: z.number().int().positive(),
  canonicalQuantity: z.number().int().positive(), canonicalUnit: canonicalUnitSchema,
  price: moneySchema,
  unitPrice: z.object({ paise: moneySchema, perQuantity: z.number().int().positive(), unit: canonicalUnitSchema }),
  available: z.boolean(), location: locationSchema,
  updatedAt: z.iso.datetime(), source: z.literal("fictional-demo-fixture"),
}).strict();
export type Product = z.infer<typeof productSchema>;
export type Match = {
  id: string; itemId: string; product: Product; packs: number;
  classification: "exact" | "equivalent" | "similar";
  reason: string; requiresApproval: boolean; lineTotal: number;
};
export type ItemMatches = { item: ShoppingItem; matches: Match[]; rejected: { productId: string; reason: string }[] };
export type Charge = { label: string; amount: number };
export type StoreOrder = {
  retailer: Retailer; lines: Match[]; subtotal: number;
  charges: Charge[]; discount: number; total: number; freeDeliveryGap: number;
};
export type Basket = { orders: StoreOrder[]; total: number; key: string; substitutions: Match[] };
export type OptimizationResult = {
  status: "optimal" | "bounded" | "infeasible";
  cheapest: Basket | null; singleStore: Basket | null; fewerDeliveries: Basket | null;
  reference: { label: string; total: number } | null;
  savings: number | null; unavailable: ShoppingItem[];
  explored: number; explanation: string;
};

export const comparisonSchema = z.object({
  items: z.array(itemSchema).min(1).max(12).refine(items => new Set(items.map(i => i.id)).size === items.length, "Item IDs must be unique"),
  location: locationSchema,
  approved: z.array(z.string().max(200)).max(300).default([]),
  retailerIds: z.array(z.enum(["freshlane", "daily", "pantry"])).min(1).max(3),
  maxRetailers: z.number().int().min(1).max(3),
  fewerDeliveryTolerance: moneySchema.max(10_000).default(2000),
}).strict();
export type ComparisonInput = z.infer<typeof comparisonSchema>;
export type ComparisonResponse = { matches: ItemMatches[]; result: OptimizationResult; retailers: Retailer[] };

/** Paise are integers everywhere. Division here is presentation only. */
export function rupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(paise / 100);
}

export function quantityLabel(quantity: number, unit: CanonicalUnit): string {
  if (unit === "g" && quantity >= 1000) return `${quantity / 1000} kg`;
  if (unit === "ml" && quantity >= 1000) return `${quantity / 1000} L`;
  return `${quantity} ${unit}`;
}

/** Round half up using exact integer arithmetic, including percentage discounts. */
export function roundedRatio(numerator: bigint, denominator: bigint): number {
  if (numerator < 0n || denominator <= 0n) throw new Error("Invalid nonnegative ratio");
  const result = (numerator + denominator / 2n) / denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount exceeds safe integer range");
  return Number(result);
}
