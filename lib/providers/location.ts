import type { Location } from "../domain";
import { deliveryContextSchema, type DeliveryContext, type Serviceability } from "./contracts";

export const illustrativePins: Record<Location, string> = { bengaluru: "560001", pune: "411001", hyderabad: "500001" };

export function demoLocation(area: Location, pin?: string): DeliveryContext {
  return deliveryContextSchema.parse({ country: "IN", demoArea: area, areaId: `demo:${area}`, pin: pin?.trim() || null });
}

/** Exact dimensions, never a nearby-store inference. No precise address is accepted. */
export function locationKey(context: DeliveryContext): string {
  const l = deliveryContextSchema.parse(context);
  return JSON.stringify([l.country, l.pin, l.areaId, l.demoArea]);
}

export function demoServiceability(providerId: string, context: DeliveryContext): Serviceability {
  const l = deliveryContextSchema.parse(context);
  const base = { providerId, locationKey: locationKey(l), itemEligibilityConfirmed: false };
  if (!l.demoArea || l.areaId !== `demo:${l.demoArea}`) return { ...base, status: "unknown", explanation: "Choose an explicit demonstration area. No live coverage lookup is enabled." };
  if (!l.pin) return { ...base, status: "available", explanation: "Illustrative demo-area coverage only. Item stock is checked separately; no real address is verified." };
  if (l.pin === illustrativePins[l.demoArea]) return { ...base, status: "available", explanation: "This PIN is an illustrative fixture for the selected demo area, not evidence of real retailer serviceability." };
  if (Object.values(illustrativePins).includes(l.pin)) return { ...base, status: "unavailable", explanation: "The PIN fixture belongs to another demo area. Change the area explicitly; no nearby store was assigned." };
  return { ...base, status: "uncertain", explanation: "PIN format is valid, but this demo has no coverage evidence for it. Clear the PIN to use the explicitly selected demo area." };
}
