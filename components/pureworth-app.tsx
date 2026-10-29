"use client";

import { useState } from "react";
import { ArrowDown, ArrowRight, Check, CheckCheck, ChevronDown, CircleHelp, Leaf, ListChecks, LoaderCircle, MapPin, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles } from "lucide-react";
import { comparisonSchema, type ComparisonResponse, type Location, type ShoppingItem } from "../lib/domain";
import { retailers } from "../lib/catalog";
import { exampleList, parseShoppingList } from "../lib/matching";
import { ComparisonResults } from "./comparison-results";
import { ListComposer } from "./list-composer";
import { MatchingReview } from "./matching-review";
import { ProductArt } from "./product-art";

function goTo(id: string, focus = false) {
  setTimeout(() => {
    const element = document.getElementById(id);
    if (focus) element?.focus({ preventScroll: true });
    element?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  }, 50);
}

export function PureWorthApp() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [draft, setDraft] = useState("");
  const [location, setLocation] = useState<Location>("bengaluru");
  const [retailerIds, setRetailerIds] = useState(["freshlane", "daily", "pantry"]);
  const [maxRetailers, setMaxRetailers] = useState(3);
  const [tolerance, setTolerance] = useState(2000);
  const [approved, setApproved] = useState<string[]>([]);
  const [response, setResponse] = useState<ComparisonResponse | null>(null);
  const [stage, setStage] = useState<"compose" | "review" | "results">("compose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function invalidate(message = "Your list is ready to compare.") {
    setResponse(null); setStage("compose"); setApproved([]); setError(""); setNotice(message);
  }
  function changeItems(next: ShoppingItem[]) { setItems(next); invalidate(); }
  function addItems(text: string): boolean {
    try {
      const parsed = parseShoppingList(text).map(item => ({ ...item, id: crypto.randomUUID() }));
      if (parsed.length + items.length > 12) throw new Error("Compare up to 12 different items. Remove an item before adding more.");
      changeItems([...items, ...parsed]); setNotice(`${parsed.length} ${parsed.length === 1 ? "item added" : "items added"}. Review quantities and brands below.`); goTo("shopping-list"); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Please review your grocery list"); goTo("shopping-error", true); return false; }
  }
  function loadExample() { changeItems(parseShoppingList(exampleList)); setNotice("Example loaded. These are fictional demo prices and stores."); goTo("shopping-list"); }

  async function compare(nextStage: "review" | "results") {
    setError("");
    const input = comparisonSchema.safeParse({ items, location, retailerIds, maxRetailers, approved, fewerDeliveryTolerance: tolerance });
    if (!input.success) { setError(!retailerIds.length ? "Choose at least one demo store before comparing." : input.error.issues[0]?.message ?? "Review your list and store preferences"); goTo("shopping-error", true); return; }
    setBusy(true); setNotice(nextStage === "review" ? "Checking package sizes and demo availability…" : "Calculating complete baskets, including all order fees…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.data), signal: controller.signal });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error ?? "Comparison failed. Please try again.");
      setResponse(data as ComparisonResponse); setStage(nextStage); setNotice(nextStage === "review" ? "Matches ready. Review exact matches and optional alternatives." : "Comparison ready. All order fees are included.");
      goTo(nextStage === "review" ? "match-review" : "comparison-results", true);
    } catch (e) { setError(e instanceof Error && e.name === "AbortError" ? "Comparison timed out. Your list is saved on this page; please try again." : e instanceof Error ? e.message : "Could not compare your list. Please try again."); setNotice(""); goTo("shopping-error", true); }
    finally { clearTimeout(timeout); setBusy(false); }
  }

  return <div id="top">
    <a href="#shopping-list" className="skip-link">Skip to shopping list</a>
    <header className="site-header"><div className="container header-inner"><a className="brand" href="#top" aria-label="PureWorth home"><span className="brand-mark"><CheckCheck size={22} strokeWidth={2.3} /></span>pureworth<span className="brand-period">.</span></a><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#shopping-list" className="nav-list"><ShoppingBag size={16} />Your list{items.length > 0 && <span>{items.length}</span>}</a></nav><span className="header-demo"><span /> DEMO EXPERIENCE</span></div></header>
    <main>
      <section className="hero container" aria-labelledby="hero-title"><div className="hero-copy"><span className="eyebrow hero-eyebrow"><span className="tiny-line" /> A LITTLE INTELLIGENCE. A LOT MORE WORTH.</span><h1 id="hero-title">Good groceries.<br /><em>Better math.</em></h1><p className="hero-description">One shopping list. Every store. The lowest total price.<br className="desktop-break" /> We do the basket math, so your money goes further.</p>
        <form className="hero-input" onSubmit={event => { event.preventDefault(); if (addItems(draft)) setDraft(""); }}><label htmlFor="shopping-input"><ListChecks size={18} />What’s on your list?</label><textarea id="shopping-input" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} disabled={busy} rows={2} placeholder="2 litres milk, 5 kg rice, 1 kg dal, 12 eggs…" required /><div><span>Type it naturally. We’ll sort the details.</span><button className="button primary" disabled={busy} type="submit">Build my list <ArrowRight size={17} /></button></div></form>
        <p className="try-example">Just looking around? <button onClick={loadExample} disabled={busy}>Try a weekly essentials list <ArrowRight size={14} /></button></p><div className="hero-trust"><span><Check size={15} /> No sign-up needed</span><span><ShieldCheck size={15} /> Every fee included</span></div>
      </div><div className="hero-visual"><div className="art-backdrop" /><span className="visual-label"><Leaf size={14} /> SHOP WELL. SPEND WISELY.</span><ProductArt category="pantry" hero /><div className="math-note"><span className="note-icon"><Sparkles size={20} /></span><div><strong>The whole basket matters.</strong><p>Item prices + store fees − eligible offers.<br />That’s where the real comparison starts.</p></div></div><span className="art-caption">A better kind of grocery run.</span></div></section>
      <div className="demo-strip"><div className="container"><InfoBadge /><p><strong>A real optimizer. Demonstration data.</strong> Explore three fictional stores. No live retailer prices, payments or orders.</p><a href="#data-and-trust">About the data <ArrowRight size={14} /></a></div></div>

      <section className="workspace-section container" aria-label="Build and compare your basket"><div className="workspace-top"><div><span className="eyebrow">LET’S MAKE YOUR NEXT SHOP COUNT</span><h2>A little planning. More in your pocket.</h2></div><label className="location-control"><MapPin size={17} /><span className="sr-only">Demo service area</span><select aria-label="Demo service area" value={location} disabled={busy} onChange={event => { setLocation(event.target.value as Location); invalidate("Demo service area changed. Compare again to refresh availability."); }}><option value="bengaluru">Bengaluru · Demo</option><option value="pune">Pune · Demo</option><option value="hyderabad">Hyderabad · Demo</option></select><ChevronDown size={14} /></label></div>
        <div className="feedback" aria-live="polite" role="status">{busy && <LoaderCircle size={16} className="spin" />}{notice}</div>{error && <div id="shopping-error" tabIndex={-1} className="error-banner" role="alert"><CircleHelp size={19} /><p>{error}</p><button className="text-button" onClick={() => setError("")}>Dismiss</button></div>}
        <div className="workspace-grid"><ListComposer items={items} busy={busy} onChange={changeItems} onAdd={addItems} onExample={loadExample} onCompare={() => void compare("review")} />
          <aside className="preferences"><div className="panel preferences-panel"><div className="preferences-title"><SlidersHorizontal size={18} /><h3>Your shop, your rules.</h3></div><fieldset disabled={busy} className="unstyled-fieldset"><legend className="field-legend">Compare fictional stores</legend>{retailers.map(retailer => <label className="retailer-option" key={retailer.id}><span className={`store-logo small ${retailer.color}`}>{retailer.initials}</span><span>{retailer.name}<small>Simulated retailer</small></span><input type="checkbox" checked={retailerIds.includes(retailer.id)} onChange={() => { setRetailerIds(ids => ids.includes(retailer.id) ? ids.filter(id => id !== retailer.id) : [...ids, retailer.id]); invalidate("Store preferences changed. Compare your list again."); }} /></label>)}
            <label className="preference-field">Maximum store orders<select value={maxRetailers} onChange={event => { setMaxRetailers(Number(event.target.value)); invalidate("Order limit changed. Compare your list again."); }}><option value={1}>1 store · keep it simple</option><option value={2}>Up to 2 stores</option><option value={3}>Up to 3 stores</option></select></label>
            <label className="preference-field">Extra budget for fewer deliveries<select value={tolerance} onChange={event => { setTolerance(Number(event.target.value)); invalidate("Delivery preference changed. Compare your list again."); }}><option value={0}>₹0 · exact lowest price</option><option value={1000}>Up to ₹10 more</option><option value={2000}>Up to ₹20 more</option><option value={5000}>Up to ₹50 more</option></select></label>
          </fieldset></div><div className="worth-note"><span className="note-icon"><Leaf size={19} /></span><h3>Cheapest item ≠ cheapest shop.</h3><p>A lower shelf price can come with another delivery fee. PureWorth compares your entire basket, fees and all.</p><a href="#how-it-works">See how it works <ArrowDown size={14} /></a></div></aside>
        </div>
        {response && stage === "review" && <MatchingReview matches={response.matches} retailers={response.retailers} approved={approved} onApproval={id => setApproved(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])} onOptimize={() => void compare("results")} busy={busy} />}
        {response && stage === "results" && <ComparisonResults result={response.result} tolerance={tolerance} onReview={() => { setStage("review"); goTo("match-review", true); }} />}
      </section>

      <section id="how-it-works" className="how-section container" aria-labelledby="how-title"><div className="how-heading"><span className="eyebrow">LESS TAB-HOPPING. MORE LIVING.</span><h2 id="how-title">From “need this” to “worth it”.</h2><p>Three simple steps. One well-considered basket.</p></div><div className="how-grid">{[
        { number: "01", icon: ListChecks, title: "Make your list", text: "Type your essentials as you’d say them. Review sizes, brands and quantities in one place." },
        { number: "02", icon: ShieldCheck, title: "Check the matches", text: "We compare like for like. A different pack or brand? You decide whether it belongs." },
        { number: "03", icon: ShoppingBag, title: "Find your best total", text: "Compare complete baskets with delivery and fees included, then choose the shop that suits you." },
      ].map(({ number, icon: Icon, title, text }) => <article key={number}><div><Icon size={25} strokeWidth={1.4} /><span>{number}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section id="data-and-trust" className="trust-section container" aria-labelledby="trust-title"><div><ShieldCheck size={29} strokeWidth={1.4} /><span className="eyebrow">CLEAR BY DESIGN</span><h2 id="trust-title">Trust begins with the details.</h2></div><div><p>Freshlane, Daily Basket and Pantry Club are fictional stores. All prices, offers and stock are authored demonstration fixtures dated 1 October 2026, not live quotes. Product illustrations are decorative.</p><p>The demo covers milk, rice, dal, oil, eggs, atta, sugar, tea, curd and bananas. It compares up to 12 list items and 3 stores. Larger searches have a visible limit and may return a best-found result.</p><details><summary>What about Blinkit, Zepto, Instamart and other retailers?</summary><p>These are future integration candidates, not connected providers. Authorized catalog access, location-specific fee quotes and separate ordering agreements are required before any live comparison or checkout. Amazon and Flipkart are also not connected. ONDC is a potential future route, without a promise of access to any particular retailer.</p></details></div></section>
    </main>
    <footer className="site-footer container"><a className="brand footer-brand" href="#top"><span className="brand-mark"><CheckCheck size={18} /></span>pureworth.</a><p>Spend thoughtfully. Live a little more.</p><span>Made for the everyday. In India.</span></footer>
  </div>;
}

function InfoBadge() { return <span className="demo-strip-icon"><ShieldCheck size={18} /></span>; }
