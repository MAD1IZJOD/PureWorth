import { createHash, timingSafeEqual } from "node:crypto";
import { betaConfig, type BetaConfig } from "./config";
import { privateHeaders } from "./http";

/** Shared invitation credential for a small beta, not a consumer account system. */
export function betaAccess(request: Request, config: BetaConfig = betaConfig()): Response | null {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  if (!config.deployed && config.access === "local" && loopback) return null;
  if (url.protocol !== "https:" || config.access !== "protected" || !config.redis || !config.accessToken) return new Response("PureWorth beta access is not ready.", { status: 503, headers: { ...privateHeaders, "Retry-After": "30", "X-Robots-Tag": "noindex, nofollow" } });
  const authorization = request.headers.get("authorization") ?? "";
  let supplied = "";
  if (/^Basic [A-Za-z0-9+/=]{1,1024}$/i.test(authorization)) {
    try { supplied = Buffer.from(authorization.slice(6), "base64").toString("utf8"); } catch { /* Invalid credentials stay rejected. */ }
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (timingSafeEqual(digest(supplied), digest(`beta:${config.accessToken}`))) return null;
  return new Response("An invitation is required for this demonstration beta.", { status: 401, headers: { ...privateHeaders, "WWW-Authenticate": 'Basic realm="PureWorth private beta", charset="UTF-8"', "X-Robots-Tag": "noindex, nofollow" } });
}
