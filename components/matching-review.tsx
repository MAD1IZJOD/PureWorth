"use client";

import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { quantityLabel, roundedRatio, rupees, type ItemMatches, type Match, type Retailer } from "../lib/domain";

function unitPrice(match: Match): string {
  const p = match.product;
  const per = p.canonicalUnit === "g" || p.canonicalUnit === "ml" ? 1000 : 1;
  const amount = roundedRatio(BigInt(p.price) * BigInt(per), BigInt(p.canonicalQuantity));
  return `${rupees(amount)} / ${p.canonicalUnit === "g" ? "kg" : p.canonicalUnit === "ml" ? "L" : p.canonicalUnit === "pieces" ? "piece" : "pack"}`;
}

export function MatchingReview({ matches, retailers, approved, onApproval, onOptimize, busy }: {
  matches: ItemMatches[]; retailers: Retailer[]; approved: string[];
  onApproval: (id: string) => void; onOptimize: () => void; busy: boolean;
}) {
  function card(match: Match) {
    const retailer = retailers.find(r => r.id === match.product.retailerId)!;
    const p = match.product;
    return <div key={match.id} className={`match-card ${approved.includes(match.id) ? "approved" : ""}`}>
      <div className="match-store"><span className={`store-dot ${retailer.color}`} />{retailer.name}<strong>{rupees(match.lineTotal)}</strong></div>
      <h4>{p.name}</h4><p>{match.packs} × {quantityLabel(p.canonicalQuantity, p.canonicalUnit)}{p.packageCount > 1 ? ` (${p.packageCount} inner packs)` : ""} · {unitPrice(match)}</p>
      {match.requiresApproval ? <><p className="match-reason">{match.reason}</p><label className="approval"><input type="checkbox" checked={approved.includes(match.id)} disabled={busy} onChange={() => onApproval(match.id)} />{approved.includes(match.id) ? "Approved for this comparison" : "Allow this alternative"}</label></> : <span className="exact-label"><Check size={13} /> Exact match</span>}
    </div>;
  }
  return <section className="panel review-panel" id="match-review" aria-labelledby="review-title" tabIndex={-1}>
    <div className="panel-heading"><div><span className="eyebrow">02 / CHECK THE DETAILS</span><h2 id="review-title">Good matches. No surprises.</h2></div><ShieldCheck size={26} className="green-text" /></div>
    <p className="section-intro">Exact matches are included automatically. Package changes, different brands and variants are only eligible when you approve them below. Every price is fictional demo data.</p>
    {matches.map(group => <div className="match-group" key={group.item.id}>
      <h3>{group.item.name}<span>{group.item.count} × {quantityLabel(group.item.quantity, group.item.unit)}</span></h3>
      <h4 className="match-section-label">Exact matches</h4>
      <div className="match-grid">{group.matches.filter(m => !m.requiresApproval).map(card)}</div>
      {!group.matches.some(m => !m.requiresApproval) && <p className="inline-notice">No exact match. Approve a suitable alternative, or edit this item.</p>}
      {group.matches.some(m => m.requiresApproval) && <details className="alternatives"><summary>Review {group.matches.filter(m => m.requiresApproval).length} alternatives · approval required</summary><div className="match-grid">{group.matches.filter(m => m.requiresApproval).map(card)}</div></details>}
      {!!group.rejected.length && <details className="rejected-matches"><summary>{group.rejected.length} products excluded by stock or package rules</summary><ul>{group.rejected.map(r => <li key={r.productId}>{r.productId}: {r.reason}</li>)}</ul></details>}
    </div>)}
    <div className="review-footer"><p><ShieldCheck size={16} /> Your original list stays in your control.</p><button className="button primary" disabled={busy} onClick={onOptimize}>{busy ? "Calculating complete baskets…" : "Find my best basket"}<ArrowRight size={18} /></button></div>
  </section>;
}
