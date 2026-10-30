"use client";

import { useEffect, useState } from "react";
import { ArrowRight, MessageSquare, ShieldCheck } from "lucide-react";
import { allowUsage, trackUsage } from "../lib/beta/usage-client";

export function BetaExperience({ feedback = false, analytics = false }: { feedback?: boolean; analytics?: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  useEffect(() => () => allowUsage(false), []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!feedback || busy) return;
    const form = event.currentTarget, fields = new FormData(form);
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: fields.get("category"), message: fields.get("message"), consent: fields.get("consent") === "on", website: fields.get("website") }), signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      if (!response.ok || data.saved !== true) throw new Error(typeof data.error === "string" ? data.error : "Feedback could not be confirmed. Please wait before retrying.");
      form.reset(); setMessage("Thank you. Your feedback was saved privately for the beta team."); trackUsage("feedback_submitted");
    } catch (error) { setFailed(true); setMessage(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Feedback could not be confirmed. It may have been saved; please wait before retrying."); }
    finally { setBusy(false); }
  }
  return <section id="beta-feedback" className="beta-section container" aria-labelledby="beta-title">
    <div className="beta-intro"><MessageSquare size={25} /><span className="eyebrow">HELP SHAPE PUREWORTH</span><h2 id="beta-title">A small beta.<br />Better with your input.</h2><p>Fictional prices. Real basket math. Tell us what could make this experience more useful.</p><p className="small-text"><ShieldCheck size={15} /> No orders or payments. No account required.</p></div>
    <div className="panel beta-panel"><details><summary>Share feedback about the demo</summary><p id="feedback-privacy">Optional text is sent to the private beta inbox only when enabled. Please leave out names, contact details, addresses and shopping lists. The inbox holds up to 500 entries and expires after 30 days without submissions.</p>
      {!feedback && <p className="inline-notice" role="status">Feedback submission is unavailable: private storage is not configured. Nothing you type here will be submitted.</p>}
      <form onSubmit={event => void submit(event)} aria-describedby="feedback-privacy" aria-busy={busy}><fieldset disabled={!feedback || busy} className="unstyled-fieldset"><legend className="sr-only">Beta feedback</legend>
        <label className="preference-field">Feedback category<select name="category" defaultValue="suggestion"><option value="matching">Product matching</option><option value="totals">Basket totals</option><option value="interface">Interface</option><option value="feature">Missing feature</option><option value="bug">Bug report</option><option value="suggestion">General suggestion</option></select></label>
        <label className="preference-field">Your feedback (optional)<textarea name="message" maxLength={1500} rows={4} placeholder="What worked? What could be clearer?" /></label><p className="small-text">Up to 1,500 characters. Personal details are not needed.</p>
        <div hidden aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <label className="beta-consent"><input name="consent" type="checkbox" required />I agree to send this feedback to the private beta inbox.</label>
        <button className="button primary" type="submit">{!feedback ? "Feedback unavailable" : busy ? "Sending feedback…" : "Send feedback"}<ArrowRight size={16} /></button>
      </fieldset></form><p className={failed ? "beta-form-error" : "beta-form-status"} role={failed ? "alert" : "status"}>{message}</p>
    </details><details><summary>Privacy and optional usage sharing</summary><p>Your list stays in this page’s memory and is sent to PureWorth’s server when you compare. Reloading clears it. Operational logs exclude shopping text and PINs; hosting infrastructure can still process connection metadata.</p><p>Optional usage sharing sends event categories such as “results viewed” and “plan downloaded”. It sends no list content or persistent identifier, uses no tracking cookies and stays off until you agree. Your choice lasts for this page only; browser privacy signals take priority.</p>
      <label className="beta-consent"><input type="checkbox" disabled={!analytics} checked={sharing} onChange={event => { const next = event.target.checked; setSharing(next); allowUsage(next && analytics); if (next) trackUsage("session_started"); }} />Share optional usage events for this page</label>{!analytics && <p className="small-text">Usage sharing is disabled in this environment.</p>}
    </details></div>
  </section>;
}
