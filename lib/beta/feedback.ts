import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { betaConfig, type BetaConfig } from "./config";
import { HttpError } from "./http";
import { feedbackScript, RedisStore } from "./redis";

export const feedbackSchema = z.object({
  category: z.enum(["matching", "totals", "interface", "feature", "bug", "suggestion"]),
  message: z.string().trim().max(1500).default(""),
  consent: z.literal(true),
  website: z.string().max(200).default(""),
}).strict();

/** Private, bounded destination; submitted text never enters logs or analytics. */
export async function saveFeedback(raw: unknown, config: BetaConfig = betaConfig(), suppliedStore?: Pick<RedisStore, "command">) {
  const parsed = feedbackSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Choose a feedback category, keep text under 1,500 characters and agree to send it.");
  if (parsed.data.website) throw new HttpError(400, "Feedback could not be accepted.");
  if (!config.feedback || !config.redis) throw new HttpError(503, "Feedback submission is unavailable because private storage is not configured. Nothing was saved.");
  const record = { id: randomUUID(), category: parsed.data.category, message: parsed.data.message, createdAt: new Date().toISOString() };
  const digest = createHash("sha256").update(`${record.category}\n${record.message}`).digest("hex");
  const tag = `{pureworth-${config.namespace}}:feedback`;
  try {
    const stored = await (suppliedStore ?? new RedisStore(config.redis)).command(["EVAL", feedbackScript, 2, `${tag}:inbox`, `${tag}:dedup:${digest}`, JSON.stringify(record)]);
    if (stored === 0) throw new HttpError(409, "This feedback was received recently. Please avoid duplicate submissions.");
    if (stored !== 1) throw new Error("Invalid storage acknowledgement");
    return { saved: true as const };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "Feedback storage could not confirm your submission. It may have been saved; please wait before retrying.");
  }
}
