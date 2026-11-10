import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, openSync, writeFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findMarker } from "./state.ts";

interface ValueDigest {
  bytes: number;
  sha256: string;
}

const PREFIX_CHUNK_BYTES = 4096;

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function serializeValue(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

function fingerprintValue(value: unknown): ValueDigest {
  const serialized = serializeValue(value);
  return {
    bytes: Buffer.byteLength(serialized),
    sha256: sha256Hex(serialized),
  };
}

function fingerprintObjectFields(record: Record<string, unknown>): Record<string, ValueDigest> {
  const entries = Object.entries(record).map(([key, value]) => [key, fingerprintValue(value)]);
  return Object.fromEntries(entries);
}

/** Compute cumulative SHA-256 hashes of `request.input` in 4 KiB steps to see where two requests diverge. */
function computeInputPrefixes(input: unknown): ValueDigest[] {
  const buffer = Buffer.from(serializeValue(input));
  const runningHash = createHash("sha256");
  const prefixes: ValueDigest[] = [];

  for (let offset = 0; offset < buffer.length; offset += PREFIX_CHUNK_BYTES) {
    const end = Math.min(offset + PREFIX_CHUNK_BYTES, buffer.length);
    runningHash.update(buffer.subarray(offset, end));
    prefixes.push({
      bytes: end,
      sha256: runningHash.copy().digest("hex"),
    });
  }

  return prefixes;
}

function findBreakpointBlockIndices(content: unknown): number[] {
  if (!Array.isArray(content)) return [];

  const indices: number[] = [];
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (block && typeof block === "object" && "prompt_cache_breakpoint" in block) {
      indices.push(i);
    }
  }
  return indices;
}

function fingerprintInputItem(item: unknown, index: number) {
  const isObjectItem = Boolean(item && typeof item === "object" && !Array.isArray(item));
  const itemRecord = isObjectItem ? (item as Record<string, unknown>) : undefined;

  return {
    index,
    ...fingerprintValue(item),
    breakpointBlocks: findBreakpointBlockIndices(itemRecord?.content),
    // Per-field hashes help tell whether a mismatch comes from message text or generated IDs.
    fields: itemRecord ? fingerprintObjectFields(itemRecord) : undefined,
  };
}

/**
 * Build a privacy-preserving fingerprint of an outgoing OpenAI request.
 * Only byte lengths and SHA-256 hashes are recorded — never raw prompt text or tool arguments.
 */
export function cacheFingerprint(request: Record<string, unknown>) {
  const input = request.input;
  return {
    version: 1,
    model: typeof request.model === "string" ? request.model : undefined,
    cacheKey: typeof request.prompt_cache_key === "string" ? request.prompt_cache_key : undefined,
    fields: fingerprintObjectFields(request),
    inputPrefixes: computeInputPrefixes(input),
    inputItems: Array.isArray(input) ? input.map(fingerprintInputItem) : undefined,
  };
}

/** Append a single line to a private (0600) log file, refusing to follow symlinks. */
function appendPrivateLogLine(logPath: string, line: string): void {
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW;
  const fd = openSync(logPath, flags, 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeFileSync(fd, line + "\n");
  } finally {
    closeSync(fd);
  }
}

/**
 * When `PI_ASSISTANT_CACHE_DEBUG=1` is set, write request fingerprints to `<session>.cache-debug.log`.
 * Logging errors warn the user and never abort the provider request.
 */
export function logCacheFingerprint(payload: unknown, ctx: ExtensionContext): void {
  if (process.env.PI_ASSISTANT_CACHE_DEBUG !== "1") return;
  if (ctx.model?.provider !== "openai" || ctx.model.api !== "openai-responses") return;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  if (!findMarker(ctx.sessionManager.getBranch())) return;

  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return;

  try {
    const record = {
      timestamp: new Date().toISOString(),
      sessionId: ctx.sessionManager.getSessionId(),
      stage: "after-assistant-cache-rewrite",
      ...cacheFingerprint(payload as Record<string, unknown>),
    };
    appendPrivateLogLine(`${sessionFile}.cache-debug.log`, JSON.stringify(record));
  } catch {
    ctx.ui.notify("Could not write assistant cache fingerprints; request will continue.", "warning");
  }
}
