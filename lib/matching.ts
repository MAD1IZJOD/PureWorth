import { itemSchema, quantityLabel, type CanonicalUnit, type ItemMatches, type Match, type Product, type ShoppingItem } from "./domain";
import { matchConfidence } from "./providers/contracts";

const units: Record<string, { unit: CanonicalUnit; factor: number }> = {
  g: { unit: "g", factor: 1 }, gram: { unit: "g", factor: 1 }, grams: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 }, kgs: { unit: "g", factor: 1000 },
  ml: { unit: "ml", factor: 1 }, l: { unit: "ml", factor: 1000 }, litre: { unit: "ml", factor: 1000 }, litres: { unit: "ml", factor: 1000 }, liter: { unit: "ml", factor: 1000 }, liters: { unit: "ml", factor: 1000 },
  piece: { unit: "pieces", factor: 1 }, pieces: { unit: "pieces", factor: 1 }, pcs: { unit: "pieces", factor: 1 },
  pack: { unit: "packs", factor: 1 }, packs: { unit: "packs", factor: 1 },
};

/** Convert decimal quantity text without floating point or silent rounding. */
export function normalizeQuantity(value: string, unit: string): { quantity: number; unit: CanonicalUnit } {
  const definition = units[unit.toLowerCase()];
  if (!definition || !/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value)) throw new Error("Use a positive quantity with up to three decimal places");
  const [whole, fraction = ""] = value.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const numerator = (BigInt(whole) * scale + BigInt(fraction || "0")) * BigInt(definition.factor);
  if (numerator % scale !== 0n || numerator === 0n || numerator / scale > 50_000n) throw new Error("Quantity must resolve to 1–50,000 whole grams, ml, pieces or packs");
  return { quantity: Number(numerator / scale), unit: definition.unit };
}

const categories = [
  { category: "milk", pattern: /\bmilk\b/i, quantity: 1000, unit: "ml", variant: "toned" },
  { category: "rice", pattern: /\brice\b/i, quantity: 5000, unit: "g", variant: "basmati" },
  { category: "dal", pattern: /\b(dal|lentils)\b/i, quantity: 1000, unit: "g", variant: "toor" },
  { category: "oil", pattern: /\boil\b/i, quantity: 1000, unit: "ml", variant: "sunflower" },
  { category: "eggs", pattern: /\beggs?\b/i, quantity: 12, unit: "pieces", variant: "regular" },
  { category: "atta", pattern: /\b(atta|flour)\b/i, quantity: 5000, unit: "g", variant: "whole wheat" },
  { category: "sugar", pattern: /\bsugar\b/i, quantity: 1000, unit: "g", variant: "refined" },
  { category: "tea", pattern: /\btea\b/i, quantity: 250, unit: "g", variant: "premium" },
  { category: "curd", pattern: /\b(curd|yogurt)\b/i, quantity: 400, unit: "g", variant: "plain" },
  { category: "bananas", pattern: /\bbananas?\b/i, quantity: 6, unit: "pieces", variant: "regular" },
] as const;
const brands = ["Tata Sampann", "India Gate", "Farm Day", "Tata Tea", "Aashirvaad", "Fortune", "Nandini", "Daawat", "Madhur", "Amul", "Orchard"];
export const exampleList = "Amul milk 1 L, India Gate basmati rice 5 kg, Tata Sampann toor dal 1 kg, Fortune sunflower oil 1 L, 12 eggs";

export function parseShoppingList(text: string): ShoppingItem[] {
  if (text.length > 2000) throw new Error("Keep your list under 2,000 characters");
  const fragments = text.split(/[,;\n]+|\s+and\s+/i).map(x => x.trim()).filter(Boolean);
  if (!fragments.length) throw new Error("Add at least one grocery item");
  if (fragments.length > 12) throw new Error("Compare up to 12 different items at a time");
  return fragments.map((fragment, index) => {
    if (/[+-]\s*\d/.test(fragment)) throw new Error("Use positive quantities without a sign");
    let clean = fragment.replace(/^[-•]\s*/, "");
    const multiplier = clean.match(/^(\d+)\s*[x×]\s*/i);
    const count = multiplier ? Number(multiplier[1]) : 1;
    if (multiplier) clean = clean.slice(multiplier[0].length);
    const amount = clean.match(/(\d+(?:\.\d+)?|\.\d+)\s*(kilograms?|kgs?|grams?|g|millilitres?|ml|litres?|liters?|l|pieces?|pcs|packs?)\b/i);
    const definition = categories.find(c => c.pattern.test(clean));
    let normalized: { quantity: number; unit: CanonicalUnit } = { quantity: definition?.quantity ?? 1, unit: definition?.unit ?? "pieces" };
    if (amount) {
      const unit = amount[2].toLowerCase().replace(/^kilograms?$/, "kg").replace(/^millilitres?$/, "ml");
      normalized = normalizeQuantity(amount[1], unit);
      clean = clean.replace(amount[0], "").trim();
    } else {
      const bare = clean.match(/\b\d+(?:\.\d+)?\b/);
      if (bare) {
        if (definition?.unit !== "pieces") throw new Error(`Specify a unit for “${fragment}”, for example kg or L`);
        normalized = normalizeQuantity(bare[0], "pieces"); clean = clean.replace(bare[0], "").trim();
      }
    }
    if (/[\d/.]/.test(clean)) throw new Error(`Use one quantity per item in “${fragment}”, for example 0.5 L or 2 x 1 L`);
    const brand = brands.find(b => new RegExp(`\\b${b}\\b`, "i").test(clean)) ?? null;
    const variant = definition?.category === "milk" && /\b(full cream|gold)\b/i.test(clean) ? "full cream" : definition?.category === "rice" && /\bbrown\b/i.test(clean) ? "brown" : /\borganic\b/i.test(clean) ? "organic" : definition?.category === "oil" && /\bmustard\b/i.test(clean) ? "mustard" : definition?.category === "dal" && /\bmoong\b/i.test(clean) ? "moong" : definition?.variant ?? "";
    // Unrecognized qualifiers remain a brand constraint instead of being silently ignored.
    let residual = brand ? clean.replace(new RegExp(`\\b${brand}\\b`, "ig"), "") : clean;
    residual = definition ? residual.replace(definition.pattern, "") : residual;
    if (variant) residual = residual.replace(new RegExp(`\\b${variant}\\b`, "ig"), "");
    if (definition?.category === "milk" && brand === "Amul") residual = residual.replace(variant === "full cream" ? /\bgold\b/ig : /\btaaza\b/ig, "");
    if (definition?.category === "eggs") residual = residual.replace(/\bwhite\b/ig, "");
    if (definition?.category === "bananas") residual = residual.replace(/\byellow\b/ig, "");
    residual = residual.trim();
    if (brand && residual) throw new Error(`Unrecognized product details “${residual}”. Keep one supported product and variant per item; these details have not been substituted.`);
    return itemSchema.parse({ id: `item-${index}`, name: clean || fragment, category: definition?.category ?? "unknown", variant, brand: brand ?? (definition && residual ? residual : null), ...normalized, count });
  });
}

export function matchProducts(items: ShoppingItem[], products: Product[], location: string): ItemMatches[] {
  return items.map(item => {
    const matches: Match[] = [];
    const rejected: ItemMatches["rejected"] = [];
    for (const product of products.filter(p => p.category === item.category && p.location === location)) {
      const totalQuantity = item.quantity * item.count;
      let rejection = "";
      if (!product.available) rejection = "Out of stock in this demo service area";
      else if (product.canonicalUnit !== item.unit) rejection = "Incompatible units";
      else if (totalQuantity % product.canonicalQuantity !== 0) rejection = "Package cannot fulfill the exact requested quantity";
      if (rejection) { rejected.push({ productId: product.id, reason: rejection, confidence: "INCOMPATIBLE" }); continue; }
      const packs = totalQuantity / product.canonicalQuantity;
      const brandMatches = !item.brand || item.brand.toLowerCase() === product.brand.toLowerCase();
      const variantMatches = !item.variant || item.variant.toLowerCase() === product.variant.toLowerCase();
      const samePackage = item.quantity === product.canonicalQuantity;
      const classification = !brandMatches || !variantMatches ? "similar" : samePackage ? "exact" : "equivalent";
      const reason = classification === "similar" ? `Different ${!brandMatches ? "brand" : "variant"}: ${product.brand}, ${product.variant}. Approval required.` : classification === "equivalent" ? `Package change: ${packs} × ${quantityLabel(product.canonicalQuantity, product.canonicalUnit)} fulfills ${quantityLabel(totalQuantity, item.unit)}. Approval required.` : "Requested brand, variant and package size match";
      matches.push({ id: `${item.id}:${product.id}`, itemId: item.id, product, packs, classification, confidence: matchConfidence(classification), reason, requiresApproval: classification !== "exact", lineTotal: product.price * packs });
    }
    const rank = { exact: 0, equivalent: 1, similar: 2 };
    matches.sort((a, b) => rank[a.classification] - rank[b.classification] || a.lineTotal - b.lineTotal || a.id.localeCompare(b.id));
    return { item, matches, rejected };
  });
}
