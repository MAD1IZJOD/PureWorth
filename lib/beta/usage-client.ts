"use client";
type UsageEvent = (typeof import("./telemetry").usageEvents)[number];
let enabled = false;
export function allowUsage(allowed: boolean) { enabled = allowed; }
export function trackUsage(event: UsageEvent) {
  if (!enabled || typeof navigator === "undefined" || navigator.doNotTrack === "1" || ("globalPrivacyControl" in navigator && navigator.globalPrivacyControl === true)) return;
  // No IDs, shopping data, cookies for tracking, storage or cross-site destination.
  void fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, consent: true }), signal: AbortSignal.timeout(2000) }).catch(() => {});
}
