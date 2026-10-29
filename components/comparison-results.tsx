"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Download, Info, Leaf, ShieldCheck, ShoppingBag, Store, Truck, X } from "lucide-react";
import { quantityLabel, rupees, type Basket, type OptimizationResult } from "../lib/domain";
import { ProductArt } from "./product-art";
import type { PricingDiagnostics } from "../lib/providers/metadata";
import { usePricingStatus } from "./pricing-status";

type Strategy = "cheapest" | "singleStore" | "fewerDeliveries";

export function ComparisonResults({ result, onReview, tolerance, pricing, busy = false, onRefresh }: { result: OptimizationResult; onReview: () => void; tolerance: number; pricing?: PricingDiagnostics; busy?: boolean; onRefresh?: () => void }) {
  const [strategy, setStrategy] = useState<Strategy>("cheapest");
  const dialog = useRef<HTMLDialogElement>(null);
  const basket = result[strategy] ?? result.cheapest;
  const quoteState = usePricingStatus(pricing);
  const current = pricing ? quoteState.current : true;
  useEffect(() => { if (!current) dialog.current?.close(); }, [current]);
  const strategies: { id: Strategy; title: string; subtitle: string; icon: typeof Leaf }[] = [
    { id: "cheapest", title: result.status === "bounded" ? "Best basket found" : "Lowest total", subtitle: "Every eligible store. Every fee.", icon: Leaf },
    { id: "singleStore", title: result.status === "bounded" ? "Single store found" : "One-store shop", subtitle: "All your essentials, one order.", icon: Store },
    { id: "fewerDeliveries", title: result.status === "bounded" ? "Fewer deliveries found" : "Fewer deliveries", subtitle: `Within ${rupees(tolerance)} of the ${result.status === "bounded" ? "best total found" : "lowest total"}.`, icon: Truck },
  ];
  function download(selected: Basket) {
    const lines = ["PureWorth — demonstration shopping plan", "Fictional prices. No order has been placed.", "", ...selected.orders.flatMap(o => [o.retailer.name, ...o.lines.map(l => `${l.packs} x ${l.product.name} (${quantityLabel(l.product.canonicalQuantity, l.product.canonicalUnit)}): ${rupees(l.lineTotal)}`), `Items: ${rupees(o.subtotal)}`, ...o.charges.map(c => `${c.label}: ${rupees(c.amount)}`), `Confirmed demo discount: -${rupees(o.discount)}`, `Store total: ${rupees(o.total)}`, ""]), `Total: ${rupees(selected.total)}`];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "pureworth-demo-shopping-plan.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const saving = current && (!pricing || pricing.comparisonComplete) && basket && result.reference ? result.reference.total - basket.total : null;
  return <section id="comparison-results" aria-labelledby="results-title" className="results-section" tabIndex={-1}>
    <div className="section-heading"><div><span className="eyebrow">03 / THE NUMBERS ARE IN</span><h2 id="results-title">Your list. A smarter total.</h2></div><button className="text-button" onClick={onReview}>Review product matches <ArrowRight size={16} /></button></div>
    <div className={`result-notice ${result.status === "bounded" ? "warning" : ""}`}><Info size={18} /><p>{result.explanation}</p></div>
    {!current && <div className="result-notice warning" role="status"><Info size={18} /><p>This is a previous or unavailable estimate. Refresh prices before previewing checkout or saving a current shopping plan.</p>{onRefresh && <button className="text-button" onClick={onRefresh} disabled={busy}>Refresh basket estimate</button>}</div>}
    {!basket ? <div className="panel empty-state"><ShoppingBag size={36} /><h3>{result.status === "bounded" ? "No complete basket found within the search limit" : "We can’t fulfill this complete list yet."}</h3><p>{result.unavailable.length ? `No eligible match for: ${result.unavailable.map(i => i.name).join(", ")}.` : "Try changing store preferences, quantities, or approved alternatives."}</p><button className="button primary" onClick={onReview}>Review matches</button></div> : <>
      <div className="strategy-grid" role="group" aria-label="Basket strategy">
        {strategies.map(({ id, title, subtitle, icon: Icon }) => {
          const candidate = result[id];
          return <button key={id} className={`strategy-card ${strategy === id ? "selected" : ""}`} onClick={() => setStrategy(id)} aria-pressed={strategy === id} disabled={!candidate}>
            <div><Icon size={20} /><span className="radio-indicator">{strategy === id && <Check size={12} />}</span></div><h3>{title}</h3><p>{subtitle}</p><strong>{candidate ? rupees(candidate.total) : result.status === "bounded" ? "Not found" : "Unavailable"}</strong><span>{candidate ? `${candidate.orders.length} ${candidate.orders.length === 1 ? "store" : "stores"} · all fees included` : result.status === "bounded" ? "Search limit reached; feasibility not proven" : "No complete eligible basket"}</span>
          </button>;
        })}
      </div>
      <div className="cart-layout"><div className="store-orders">
        {basket.orders.map(order => <article className="panel store-order" key={order.retailer.id}>
          <div className="store-heading"><div className={`store-logo ${order.retailer.color}`}>{order.retailer.initials}</div><div><h3>{order.retailer.name}</h3><p>Simulated retailer · {order.lines.length} list items</p></div><span className="demo-chip">DEMO</span></div>
          <ul>{order.lines.map(line => <li className="cart-line" key={line.id}><div className="product-thumb small"><ProductArt category={line.product.category} /></div><div><h4>{line.product.name}</h4><p>{line.packs} × {quantityLabel(line.product.canonicalQuantity, line.product.canonicalUnit)} · {rupees(line.product.price)} per pack</p>{line.requiresApproval && <span className="substitution-badge">Approved {line.classification === "equivalent" ? "package change" : "substitution"}</span>}</div><strong>{rupees(line.lineTotal)}</strong></li>)}</ul>
          <dl className="fee-breakdown"><div><dt>Items subtotal</dt><dd>{rupees(order.subtotal)}</dd></div>{order.charges.filter(c => c.amount || c.label === "Delivery").map(charge => <div key={charge.label}><dt>{charge.label}</dt><dd className={!charge.amount ? "green-text" : ""}>{charge.amount ? rupees(charge.amount) : "Free"}</dd></div>)}{!!order.discount && <div className="green-text"><dt>{order.retailer.fees.discount?.label}</dt><dd>−{rupees(order.discount)}</dd></div>}<div className="order-total"><dt>Store total</dt><dd>{rupees(order.total)}</dd></div></dl>
          {order.retailer.fees.freeDeliveryAt !== null && <div className="threshold-info"><Truck size={15} /><span>{order.freeDeliveryGap ? `${rupees(order.freeDeliveryGap)} below the ${rupees(order.retailer.fees.freeDeliveryAt)} free-delivery threshold. Adding products may cost more than delivery.` : `Free delivery unlocked at ${rupees(order.retailer.fees.freeDeliveryAt)}.`}</span></div>}
          <p className="allocation-note">Selected as part of this complete basket, with this store’s order fees and confirmed demo offers included.</p>
        </article>)}
      </div><aside className="checkout-card">
        <span className="eyebrow">YOUR SMART CART</span><h3>Everything accounted for.</h3>
        <dl><div><dt>Groceries</dt><dd>{rupees(basket.orders.reduce((n, o) => n + o.subtotal, 0))}</dd></div><div><dt>All order fees</dt><dd>{rupees(basket.orders.reduce((n, o) => n + o.charges.reduce((s, c) => s + c.amount, 0), 0))}</dd></div><div><dt>Confirmed demo offers</dt><dd>−{rupees(basket.orders.reduce((n, o) => n + o.discount, 0))}</dd></div><div className="grand-total"><dt>{current ? "Basket estimate" : "Previous estimate"}</dt><dd data-testid="basket-total">{rupees(basket.total)}</dd></div></dl>
        {saving !== null && result.reference ? <div className="savings-note"><Leaf size={18} /><p><small>Estimated comparison · not guaranteed savings</small>{saving > 0 ? <><strong>{rupees(saving)} lower</strong> than the reference basket.</> : saving === 0 ? "This strategy matches the reference total." : `${rupees(-saving)} above the reference total.`}<small>Reference: {result.reference.label}, {rupees(result.reference.total)}.</small></p></div> : <p className="small-text">No current, complete comparable reference is available. No savings are claimed.</p>}
        <button className="button primary" disabled={busy || !current} onClick={() => dialog.current?.showModal()}>Checkout preview <ArrowRight size={17} /></button><button className="text-button export-button" disabled={busy || !current} onClick={() => download(basket)}><Download size={15} /> Save shopping plan</button><p className="checkout-disclaimer"><ShieldCheck size={14} /> Demo only. No payment or order placement.</p>
      </aside></div>
      {!!basket.substitutions.length && <div className="result-notice"><Info size={18} /><p>{basket.substitutions.length} approved package or product alternatives are included and marked in your cart.</p></div>}
      <dialog ref={dialog} className="checkout-dialog" aria-labelledby="checkout-title" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        <form method="dialog"><button className="icon-button dialog-close" aria-label="Close checkout preview"><X size={20} /></button></form><div className="dialog-symbol"><ShoppingBag size={28} /></div><span className="eyebrow">A CLEAR NEXT STEP</span><h2 id="checkout-title">Your basket, ready to review.</h2><p>This is a demonstration checkout for {basket.orders.length} simulated store {basket.orders.length === 1 ? "order" : "orders"}. The estimated total is <strong>{rupees(basket.total)}</strong>.</p><div className="inline-notice">No payment will be collected. No retailer order has been placed.</div><p>Real checkout needs authorized retailer ordering, a fresh quote, your final consent and a payment provider. Those connections are not enabled.</p><button className="button primary" disabled>Ordering unavailable in demo</button><form method="dialog"><button className="text-button">Back to my basket <ArrowRight size={16} /></button></form>
      </dialog>
    </>}
  </section>;
}
