import { feeSchema, productSchema, type FeeRules, type Location, type Product, type Retailer } from "./domain";

/** Contract for authorized providers. Search does not imply checkout capability. */
export interface RetailerAdapter {
  readonly mode: "demo" | "live";
  readonly orderingSupported: boolean;
  search(query: string, location: Location): Promise<Product[]>;
  getProduct(id: string, location: Location): Promise<Product | null>;
  getPrices(ids: string[], location: Location): Promise<{ id: string; price: number }[]>;
  getAvailability(ids: string[], location: Location): Promise<{ id: string; available: boolean }[]>;
  getRetailers(location: Location): Promise<Retailer[]>;
  getFeeRules(retailerId: string, location: Location): Promise<FeeRules | null>;
  freshness(): { updatedAt: string; source: string; live: boolean };
}

const baseFees: FeeRules = {
  delivery: 2500, freeDeliveryAt: 49900, minimumOrder: 0,
  handling: 500, platform: 200, smallOrderBelow: 19900, smallOrderFee: 1500,
  other: 0, discount: null,
};
export const retailers: Retailer[] = [
  { id: "freshlane", name: "Freshlane", initials: "fl", color: "green", fees: feeSchema.parse(baseFees) },
  { id: "daily", name: "Daily Basket", initials: "db", color: "orange", fees: feeSchema.parse({ ...baseFees, delivery: 1900, freeDeliveryAt: 69900, minimumOrder: 9900, handling: 300, platform: 400, smallOrderFee: 1000 }) },
  { id: "pantry", name: "Pantry Club", initials: "pc", color: "purple", fees: feeSchema.parse({ ...baseFees, delivery: 3500, freeDeliveryAt: 99900, minimumOrder: 19900, handling: 0, platform: 0, smallOrderFee: 0, discount: { label: "Demo pantry offer", minimum: 100000, fixed: 2000, basisPoints: 0, cap: 2000, confirmed: true } }) },
];

type Seed = { sku: string; name: string; brand: string; category: string; variant: string; quantity: number; unit: Product["packageUnit"]; prices: [number, number, number]; packageCount?: number };
const seeds: Seed[] = [
  { sku: "milk", name: "Amul Taaza toned milk", brand: "Amul", category: "milk", variant: "toned", quantity: 1, unit: "L", prices: [6900, 6600, 7200] },
  { sku: "rice", name: "India Gate basmati rice", brand: "India Gate", category: "rice", variant: "basmati", quantity: 5, unit: "kg", prices: [58900, 57900, 51900] },
  { sku: "dal", name: "Tata Sampann toor dal", brand: "Tata Sampann", category: "dal", variant: "toor", quantity: 1, unit: "kg", prices: [13900, 15500, 21900] },
  { sku: "oil", name: "Fortune sunflower oil", brand: "Fortune", category: "oil", variant: "sunflower", quantity: 1, unit: "L", prices: [15500, 16900, 14900] },
  { sku: "eggs", name: "Farm Day white eggs", brand: "Farm Day", category: "eggs", variant: "regular", quantity: 6, unit: "pieces", packageCount: 2, prices: [9600, 10900, 12900] },
  { sku: "atta", name: "Aashirvaad whole wheat atta", brand: "Aashirvaad", category: "atta", variant: "whole wheat", quantity: 5, unit: "kg", prices: [28900, 27500, 26900] },
  { sku: "sugar", name: "Madhur refined sugar", brand: "Madhur", category: "sugar", variant: "refined", quantity: 1, unit: "kg", prices: [5200, 4900, 5500] },
  { sku: "tea", name: "Tata Tea premium tea", brand: "Tata Tea", category: "tea", variant: "premium", quantity: 250, unit: "g", prices: [14900, 15900, 13900] },
  { sku: "curd", name: "Amul plain curd", brand: "Amul", category: "curd", variant: "plain", quantity: 400, unit: "g", prices: [4500, 4200, 4800] },
  { sku: "bananas", name: "Orchard yellow bananas", brand: "Orchard", category: "bananas", variant: "regular", quantity: 6, unit: "pieces", prices: [4900, 4500, 5500] },
  { sku: "rice-small", name: "India Gate basmati rice", brand: "India Gate", category: "rice", variant: "basmati", quantity: 1, unit: "kg", prices: [11900, 11500, 10900] },
  { sku: "rice-alt", name: "Daawat basmati rice", brand: "Daawat", category: "rice", variant: "basmati", quantity: 5, unit: "kg", prices: [47900, 49500, 48900] },
  { sku: "milk-alt", name: "Nandini toned milk", brand: "Nandini", category: "milk", variant: "toned", quantity: 1, unit: "L", prices: [6200, 6100, 6500] },
  { sku: "milk-rich", name: "Amul Gold full cream milk", brand: "Amul", category: "milk", variant: "full cream", quantity: 1, unit: "L", prices: [7800, 7600, 7900] },
];

export function demoCatalog(location: Location): Product[] {
  return retailers.flatMap((retailer, index) => seeds.map(seed => {
    const packageCount = seed.packageCount ?? 1;
    const canonicalUnit = seed.unit === "kg" ? "g" : seed.unit === "L" ? "ml" : seed.unit;
    const canonicalQuantity = seed.quantity * (seed.unit === "kg" || seed.unit === "L" ? 1000 : 1) * packageCount;
    const price = seed.prices[index];
    return productSchema.parse({
      id: `${retailer.id}-${seed.sku}`, retailerProductId: `demo-${seed.sku}`,
      retailerId: retailer.id, name: seed.name, brand: seed.brand,
      category: seed.category, variant: seed.variant,
      packageQuantity: seed.quantity, packageUnit: seed.unit, packageCount,
      canonicalQuantity, canonicalUnit, price,
      unitPrice: { paise: price, perQuantity: canonicalQuantity, unit: canonicalUnit },
      available: !(location === "pune" && seed.sku === "eggs" && retailer.id === "daily") && !(location === "hyderabad" && seed.sku === "milk-alt") && !(retailer.id === "pantry" && seed.sku === "curd"),
      location, updatedAt: "2026-10-01T00:00:00.000Z", source: "fictional-demo-fixture",
    });
  }));
}

export const demoAdapter: RetailerAdapter = {
  mode: "demo", orderingSupported: false,
  async search(query, location) {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return demoCatalog(location).filter(p => words.every(w => `${p.name} ${p.category}`.toLowerCase().includes(w)));
  },
  async getProduct(id, location) { return demoCatalog(location).find(p => p.id === id) ?? null; },
  async getPrices(ids, location) { return demoCatalog(location).filter(p => ids.includes(p.id)).map(({ id, price }) => ({ id, price })); },
  async getAvailability(ids, location) { return demoCatalog(location).filter(p => ids.includes(p.id)).map(({ id, available }) => ({ id, available })); },
  async getRetailers() { return structuredClone(retailers); },
  async getFeeRules(id) { return structuredClone(retailers.find(r => r.id === id)?.fees ?? null); },
  freshness() { return { updatedAt: "2026-10-01T00:00:00.000Z", source: "Fictional demonstration catalog; not live retailer data", live: false }; },
};
