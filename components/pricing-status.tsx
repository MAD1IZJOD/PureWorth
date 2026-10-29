"use client";

import { useEffect, useState } from "react";
import { Clock3, MapPin, RefreshCw, ShieldCheck } from "lucide-react";
import type { Location } from "../lib/domain";
import type { Simulation } from "../lib/providers/contracts";
import { demoFreshnessPolicy } from "../lib/providers/freshness";
import { demoLocation, demoServiceability } from "../lib/providers/location";
import type { PricingDiagnostics } from "../lib/providers/metadata";
import { providerDefinitions } from "../lib/providers/registry";

export function usePricingStatus(pricing?: PricingDiagnostics) {
  const [clock, setClock] = useState({ timestamp: 0, generation: "" });
  useEffect(() => {
    if (!pricing) return;
    const receivedAt = Date.now();
    const serverAt = Date.parse(pricing.generatedAt);
    const timer = setInterval(() => setClock({ timestamp: serverAt + Math.max(0, Date.now() - receivedAt), generation: pricing.generatedAt }), 1000);
    return () => clearInterval(timer);
  }, [pricing]);
  // Measure elapsed client time against the server snapshot, not the device wall-clock offset.
  const now = pricing && clock.generation === pricing.generatedAt ? clock.timestamp : pricing ? Date.parse(pricing.generatedAt) : 0;
  let freshness = pricing?.freshness ?? "UNKNOWN";
  const expired = !!pricing?.expiresAt && Date.parse(pricing.expiresAt) <= now;
  if (expired) freshness = "EXPIRED";
  else if (pricing?.mode === "DEMO DATA" && freshness !== "UNKNOWN") {
    const age = Math.max(0, ...Object.values(pricing.offers).map(o => (o.freshness.ageMs ?? 0) + Math.max(0, now - Date.parse(pricing.generatedAt))));
    if (age >= demoFreshnessPolicy.agingMs) freshness = "STALE";
    else if (age >= demoFreshnessPolicy.freshMs) freshness = "AGING";
  }
  const current = !!pricing?.current && !expired && ["FRESH", "AGING"].includes(freshness);
  return { freshness, current, expired };
}

export function PricingStatus({ location, pin, onPin, onPinEdit, simulation, onSimulation, pricing, busy, canRefresh, onRefresh }: {
  location: Location; pin: string; onPin: (pin: string) => void; onPinEdit?: () => void;
  simulation: Simulation; onSimulation: (simulation: Simulation) => void;
  pricing?: PricingDiagnostics; busy: boolean; canRefresh: boolean; onRefresh: () => void;
}) {
  const status = usePricingStatus(pricing);
  let coverage = "Enter a six-digit Indian PIN beginning with 1–9, or leave it empty for the selected demo area.";
  try { coverage = demoServiceability("demo", demoLocation(location, pin)).explanation; } catch { /* Format guidance above; API validation also rejects invalid PINs. */ }
  const providers = pricing?.providers ?? providerDefinitions.map(p => ({ id: p.id, name: p.name, enabled: p.featureEnabled, issue: p.featureEnabled ? "Simulated local fixtures" : "Not connected: authorization and credentials required", serviceability: null }));
  return <section className="panel pricing-panel" aria-label="Price data and coverage">
    <div className="pricing-heading"><div><span className="demo-chip">{pricing?.mode ?? "DEMO DATA"}</span><h3>Know what’s behind your price.</h3></div><ShieldCheck size={23} className="green-text" /></div>
    <div className="pricing-context"><div className="pin-field"><label htmlFor="delivery-pin"><MapPin size={15} /> Delivery PIN <span>(optional)</span></label><input id="delivery-pin" inputMode="numeric" autoComplete="postal-code" maxLength={6} defaultValue={pin} onChange={onPinEdit} onBlur={e => onPin(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} disabled={busy} placeholder="e.g. 560001" aria-describedby="coverage-explanation" /><p id="coverage-explanation">{coverage}</p></div>
      <div className="freshness-summary"><span className="field-legend"><Clock3 size={15} /> Snapshot status</span><strong data-testid="freshness-status">{pricing ? status.freshness : "No comparison yet"}</strong><p>Price verification unavailable. Prices are fictional fixtures; freshness describes the simulated response only.</p>{pricing && <p className="quote-state">{!status.current ? "Refresh required before using a current basket estimate." : pricing.comparisonComplete ? "Complete basket estimate · illustrative 5-minute expiry." : "Incomplete comparison · savings withheld."}</p>}<button className="text-button" onClick={onRefresh} disabled={busy || !canRefresh}><RefreshCw size={15} />{busy ? "Refreshing…" : "Refresh prices"}</button></div>
    </div>
    {pricing && (!status.current || !pricing.comparisonComplete) && <div className="inline-notice" role="status">{status.expired ? "This basket estimate has expired. Refresh prices to recalculate." : !pricing.comparisonComplete ? "Some price, coverage or fee data is incomplete. No savings are claimed." : "These prices need a refresh."}</div>}
    <details className="provider-availability"><summary>Provider availability · real connections are not enabled</summary><ul>{providers.map(p => <li key={p.id}><strong>{p.name}</strong><span>{p.enabled ? p.issue ?? `Simulation available · ${p.serviceability?.status ?? "demo area"}` : "Not connected · permission and credentials required"}</span></li>)}</ul></details>
    <details className="integration-sandbox"><summary>Explore simulated provider states</summary><p>Test the integration safeguards using fictional data. Refresh prices restores the normal simulation.</p><label htmlFor="simulation-state">Simulation scenario<select id="simulation-state" value={simulation} onChange={e => onSimulation(e.target.value as Simulation)} disabled={busy}><option value="normal">Normal demo responses</option><option value="stale">Stale offers · all demo stores</option><option value="expired">Expired offers · all demo stores</option><option value="timeout">Provider timeout · Daily Basket</option><option value="partial">Partial catalog · Daily Basket</option><option value="missing-fees">Missing fees · all demo stores</option></select></label></details>
  </section>;
}
