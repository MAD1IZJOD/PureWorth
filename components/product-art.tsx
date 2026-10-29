/** Original vector package illustrations; decorative, with no external images. */
export function ProductArt({ category, hero = false }: { category: string; hero?: boolean }) {
  if (hero) return <svg className="hero-art" viewBox="0 0 550 430" role="img" aria-label="Illustrated grocery bag with milk, rice, oil and fresh leaves">
    <ellipse cx="283" cy="376" rx="197" ry="22" fill="#163e31" opacity=".13" />
    <path d="M359 192c-4-74 44-133 93-133-8 65-43 101-93 133" fill="#749879" />
    <path d="M366 196c29-42 68-59 107-49-28 45-69 57-107 49" fill="#a2b58a" />
    <path d="M367 231c-4-83 27-129 54-149" stroke="#386745" strokeWidth="4" fill="none" />
    <g transform="rotate(-12 170 160)"><path d="M123 111l16-30h68l13 30v165h-97z" fill="#f9f8ed" /><path d="M123 111h97l-13-30h-68z" fill="#c7d9d5" /><path d="M123 166h97v66h-97z" fill="#507e8b" /><text x="171" y="191" textAnchor="middle" fill="white" fontSize="13" letterSpacing="3">FRESH</text><text x="171" y="214" textAnchor="middle" fill="white" fontFamily="Georgia" fontSize="23">milk</text><path d="M139 81l29 30v55" stroke="#9db9b5" fill="none" strokeWidth="2" /></g>
    <g transform="rotate(8 298 175)"><path d="M238 103q55-13 112 0l10 185H230z" fill="#f3d39d" /><path d="M239 103q55 13 111 0" stroke="#b28b50" strokeWidth="3" /><rect x="246" y="139" width="98" height="103" rx="2" fill="#b45738" /><path d="M279 158q16 15 0 29m10-29q16 15 0 29m10-29q16 15 0 29" stroke="#f4d6a4" fill="none" strokeWidth="2" /><text x="295" y="211" textAnchor="middle" fontFamily="Georgia" fill="#fff4df" fontSize="27">basmati</text><text x="295" y="228" textAnchor="middle" fill="#fff4df" fontSize="8" letterSpacing="3">PANTRY ESSENTIALS</text></g>
    <g transform="rotate(14 385 235)"><rect x="368" y="137" width="30" height="18" rx="3" fill="#475b33" /><path d="M370 155h26v30q20 14 20 32v81h-66v-81q0-18 20-32z" fill="#ddad49" /><rect x="350" y="224" width="66" height="49" fill="#fff3cf" /><text x="383" y="245" textAnchor="middle" fontFamily="Georgia" fontSize="15" fill="#5c633b">sunflower</text><text x="383" y="262" textAnchor="middle" fontFamily="Georgia" fontSize="17" fill="#5c633b">oil</text></g>
    <path d="M112 231h317l-24 142H137z" fill="#ceb58b" /><path d="M129 245h283l-20 116H150z" fill="#d9c19a" />
    <path d="M197 250v-28q0-72 73-72t73 72v28" stroke="#9c8056" strokeWidth="12" fill="none" />
    <path d="M204 249v-27q0-65 66-65t66 65v27" stroke="#ead5b1" strokeWidth="5" fill="none" />
    <circle cx="270" cy="307" r="29" fill="#274d3c" /><path d="M251 307l13 12 25-27" fill="none" stroke="#e6eac7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M148 361h244M156 350l-11-95m240 95 18-95" stroke="#b69b73" fill="none" opacity=".5" strokeWidth="2" />
  </svg>;
  const colors: Record<string, [string, string, string]> = { milk: ["#e8eeec", "#638d98", "MILK"], rice: ["#f2e3c5", "#ad6446", "RICE"], dal: ["#eee1b9", "#b59953", "DAL"], oil: ["#f3dfab", "#8d8a4a", "OIL"], eggs: ["#e5dfd3", "#9b8e6e", "EGGS"], atta: ["#efdbbd", "#a76f41", "ATTA"], tea: ["#e3e9cf", "#62744e", "TEA"] };
  const [base, accent, label] = colors[category] ?? ["#e8e7d9", "#79886a", category.slice(0, 5).toUpperCase()];
  return <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill={base} opacity=".45" />{category === "eggs" ? <><path d="M10 30h44l-5 20H15z" fill={accent} opacity=".5" />{[21, 33, 45].map(x => <ellipse key={x} cx={x} cy="30" rx="7" ry="10" fill="#faf5e9" stroke="#b4a88c" />)}</> : <><path d={category === "oil" ? "M26 12h12v12l6 6v23H20V30l6-6z" : "M18 15l5-6h18l5 6v40H18z"} fill={base} stroke={accent} strokeWidth="1.2" /><path d="M18 29h28v18H18z" fill={accent} /><text x="32" y="40" textAnchor="middle" fill="white" fontSize="7" fontWeight="700" letterSpacing="1">{label}</text><path d="M24 16h16M25 20h14" stroke={accent} opacity=".5" /></>}</svg>;
}
