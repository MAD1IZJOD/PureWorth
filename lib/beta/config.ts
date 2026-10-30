import { z } from "zod";

type Environment = Record<string, string | undefined>;
const endpoint = z.url().refine(value => {
  const u = new URL(value);
  return u.protocol === "https:" && /^[a-z0-9-]+\.upstash\.io$/.test(u.hostname) && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/" && !u.port;
});

/** Server-only configuration. Never serialize this object into client props. */
export function betaConfig(env: Environment = process.env) {
  const deployed = env.VERCEL === "1" || ["staging", "production"].includes(env.PUREWORTH_ENV ?? "");
  const redisUrl = endpoint.safeParse(env.UPSTASH_REDIS_REST_URL);
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
  const redis = redisUrl.success && redisToken && /^[\x21-\x7e]{20,4096}$/.test(redisToken) ? { url: redisUrl.data, token: redisToken } : null;
  const accessToken = env.PUREWORTH_BETA_TOKEN;
  const protectedMode = env.PUREWORTH_ACCESS === "protected" && !!accessToken && /^[\x21-\x7e]{32,256}$/.test(accessToken);
  return {
    deployed, access: deployed ? protectedMode ? "protected" as const : "blocked" as const : "local" as const,
    accessToken: protectedMode ? accessToken! : null, redis,
    namespace: env.VERCEL_ENV === "production" || env.PUREWORTH_ENV === "production" ? "production" : "preview",
    feedback: env.PUREWORTH_FEEDBACK === "true" && !!redis,
    analytics: env.PUREWORTH_ANALYTICS === "true",
    demoPricing: true, liveProviders: false, checkout: false, ordering: false,
  };
}
export type BetaConfig = ReturnType<typeof betaConfig>;
export function publicBetaFlags(config = betaConfig()) {
  return { feedback: config.feedback, analytics: config.analytics, demoPricing: true, checkout: false, ordering: false };
}
