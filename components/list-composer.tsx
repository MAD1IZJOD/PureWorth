"use client";

import { useState } from "react";
import { ListPlus, Minus, Plus, Trash2, ShoppingBasket, ArrowRight } from "lucide-react";
import { quantityLabel, type ShoppingItem } from "../lib/domain";
import { ProductArt } from "./product-art";

type Props = {
  items: ShoppingItem[]; busy: boolean;
  onChange: (items: ShoppingItem[]) => void;
  onAdd: (text: string) => boolean;
  onExample: () => void;
  onCompare: () => void;
};

export function ListComposer({ items, busy, onChange, onAdd, onExample, onCompare }: Props) {
  const [draft, setDraft] = useState("");
  const update = (id: string, change: Partial<ShoppingItem>) => onChange(items.map(item => item.id === id ? { ...item, ...change } : item));
  return <section className="panel list-panel" aria-labelledby="list-title" id="shopping-list">
    <div className="panel-heading"><div><span className="eyebrow">YOUR STARTING POINT</span><h2 id="list-title">One list. All your essentials.</h2></div><span className="count-badge">{items.length} / 12 items</span></div>
    <fieldset disabled={busy} className="unstyled-fieldset">
      <form className="quick-add" onSubmit={event => { event.preventDefault(); if (onAdd(draft)) setDraft(""); }}>
        <ListPlus size={20} aria-hidden="true" /><label className="sr-only" htmlFor="quick-item">Add a grocery item</label><input id="quick-item" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add an item, e.g. Amul milk 1 L" maxLength={2000} required /><button className="icon-button" aria-label="Add grocery item" type="submit"><Plus size={20} /></button>
      </form>
      {!items.length ? <div className="empty-state"><ShoppingBasket size={36} strokeWidth={1.2} /><h3>Your next smart shop starts here.</h3><p>Add a few essentials above, or give our weekly list a try.</p><button className="text-button" onClick={onExample} type="button">Load the example list <ArrowRight size={16} /></button></div> : <ul className="shopping-items">
        {items.map(item => <li key={item.id} className="shopping-item" data-testid="shopping-item">
          <div className="product-thumb"><ProductArt category={item.category} /></div>
          <div className="item-info"><h3>{item.name}</h3><p>{quantityLabel(item.quantity, item.unit)} per requested pack{item.brand ? ` · ${item.brand}` : " · Any brand"}</p>
            <details className="item-edit"><summary>Edit size & brand</summary><div className="edit-fields">
              <label>Quantity ({item.unit})<input aria-label={`Package quantity for ${item.name}`} type="number" min="1" max="50000" step="1" value={item.quantity} onChange={event => { const quantity = Number(event.target.value); if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 50000) update(item.id, { quantity }); }} /></label>
              <label>Brand preference<input aria-label={`Brand for ${item.name}`} value={item.brand ?? ""} maxLength={50} placeholder="Any brand" onChange={event => update(item.id, { brand: event.target.value || null })} /></label>
            </div></details>
          </div>
          <div className="item-actions"><div className="stepper" aria-label={`Number of packs for ${item.name}`}><button type="button" aria-label={`Decrease ${item.name}`} disabled={item.count <= 1} onClick={() => update(item.id, { count: item.count - 1 })}><Minus size={14} /></button><span aria-live="polite">{item.count}</span><button type="button" aria-label={`Increase ${item.name}`} disabled={item.count >= 20} onClick={() => update(item.id, { count: item.count + 1 })}><Plus size={14} /></button></div><button type="button" className="icon-button remove" aria-label={`Remove ${item.name}`} onClick={() => onChange(items.filter(i => i.id !== item.id))}><Trash2 size={16} /></button></div>
        </li>)}
      </ul>}
      <div className="list-footer"><p>Package sizes are explicit. Alternatives need your approval.</p><button type="button" className="button primary" disabled={!items.length} onClick={onCompare}>{busy ? "Finding your matches…" : "Compare my list"}<ArrowRight size={18} /></button></div>
    </fieldset>
  </section>;
}
