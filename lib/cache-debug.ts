import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, openSync, writeFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findMarker } from "./state.ts";

const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const serialized = (value: unknown) => JSON.stringify(value) ?? "undefined";
const fingerprint = (value: unknown) => {
  const data = serialized(value);
  return { bytes: Buffer.byteLength(data), sha256: digest(data) };
};

/** Fingerprint serialized JSON, not provider tokens or hidden server context. */
export function cacheFingerprint(request: Record<string, unknown>) {
  const input = request.input;
  const bytes = Buffer.from(serialized(input));
  const prefix = createHash("sha256");
  const inputPrefixes = [];
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    const end = Math.min(offset + 4096, bytes.length);
    prefix.update(bytes.subarray(offset, end));
    inputPrefixes.push({ bytes: end, sha256: prefix.copy().digest("hex") });
  }
  return {
    version: 1,
    model: typeof request.model === "string" ? request.model : undefined,
    cacheKey: typeof request.prompt_cache_key === "string" ? request.prompt_cache_key : undefined,
    fields: Object.fromEntries(Object.entries(request).map(([key, value]) => [key, fingerprint(value)])),
    inputPrefixes,
    inputItems: Array.isArray(input) ? input.map((item, index) => ({
      index, ...fingerprint(item),
      breakpointBlocks: Array.isArray(item?.content) ? item.content.flatMap((block: unknown, i: number) =>
        block && typeof block === "object" && "prompt_cache_breakpoint" in block ? [i] : []) : [],
      // Field hashes distinguish changed content from IDs/signatures without logging either.
      fields: item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).map(([key, value]) => [key, fingerprint(value)]))
        : undefined,
    })) : undefined,
  };
}

/** Diagnostic failures must never abort a provider request. No raw payload is written. */
export function logCacheFingerprint(payload: unknown, ctx: ExtensionContext): void {
  if (process.env.PI_ASSISTANT_CACHE_DEBUG !== "1") return;
  if (ctx.model?.provider !== "openai" || ctx.model.api !== "openai-responses") return;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  if (!findMarker(ctx.sessionManager.getBranch())) return;
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return;

  try {
    const record = {
      timestamp: new Date().toISOString(), sessionId: ctx.sessionManager.getSessionId(),
      stage: "after-assistant-cache-rewrite", ...cacheFingerprint(payload as Record<string, unknown>),
    };
    const fd = openSync(`${sessionFile}.cache-debug.log`,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, JSON.stringify(record) + "\n");
    } finally { closeSync(fd); }
  } catch {
    ctx.ui.notify("Could not write assistant cache fingerprints; request will continue.", "warning");
  }
}
