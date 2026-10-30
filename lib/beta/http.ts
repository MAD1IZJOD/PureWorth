export const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function errorResponse(error: unknown): Response {
  return Response.json({ error: error instanceof HttpError ? error.message : "This action is temporarily unavailable. Please try again." }, { status: error instanceof HttpError ? error.status : 503, headers: privateHeaders });
}

export async function readJson(request: Request, limit = 32_768): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Cross-origin requests are unavailable");
  if (origin) {
    try {
      const source = new URL(origin);
      const expectedHost = request.headers.get("host") ?? new URL(request.url).host;
      if (!["http:", "https:"].includes(source.protocol) || source.host !== expectedHost) throw new Error();
    } catch { throw new HttpError(403, "Cross-origin requests are unavailable"); }
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new HttpError(415, "Send an application/json request");
  if (![null, "identity"].includes(request.headers.get("content-encoding"))) throw new HttpError(415, "Compressed requests are unavailable");
  if (Number(request.headers.get("content-length")) > limit) throw new HttpError(413, `Request exceeds the ${limit / 1024} KB limit`);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required");
  let text = "", size = 0, expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 5000);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new HttpError(413, `Request exceeds the ${limit / 1024} KB limit`); }
      text += decoder.decode(part.value, { stream: true });
    }
    if (expired) throw new HttpError(408, "Request body timed out. Please try again.");
    text += decoder.decode();
  } catch (error) { throw error instanceof HttpError ? error : new HttpError(expired ? 408 : 400, expired ? "Request body timed out. Please try again." : "Could not read the request"); }
  finally { clearTimeout(timer); reader.releaseLock(); }
  // Bound nesting before JSON.parse, including malicious objects outside the schema.
  let depth = 0, quoted = false, escaped = false;
  for (const character of text) {
    if (quoted) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === '"') quoted = false; }
    else if (character === '"') quoted = true;
    else if (character === "[" || character === "{") { if (++depth > 12) throw new HttpError(400, "Request nesting is too deep"); }
    else if (character === "]" || character === "}") depth--;
  }
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Invalid JSON request"); }
}
