"use client";

import { useEffect, useRef } from "react";

export default function ShoppingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className="container workspace-section"><section className="panel empty-state" role="alert"><span className="eyebrow">PUREWORTH · DEMONSTRATION BETA</span><h1 ref={heading} tabIndex={-1}>Let’s get you back to your list.</h1><p>This view could not be loaded. No payment or order has occurred. Retrying or reloading may clear your draft because shopping lists stay in page memory.</p><button className="button primary" onClick={reset}>Try loading again</button><p><button className="text-button" onClick={() => window.location.assign("/")}>Start a fresh shopping list</button></p></section></main>;
}
