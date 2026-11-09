import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findMarker } from "./state.ts";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);

/** Add a checkpoint only for GPT models whose Pi compatibility metadata opts in. */
function inheritedBreakpoint(request: JsonObject, ctx: ExtensionContext, boundaryId: string | undefined): JsonObject {
  const model = ctx.model;
  const supportsExplicitCache = model?.api === "openai-responses" &&
    (model.compat as { supportsExplicitPromptCacheMode?: boolean } | undefined)?.supportsExplicitPromptCacheMode === true;
  if (typeof request.model !== "string" || !request.model.startsWith("gpt-") || !supportsExplicitCache ||
      !Array.isArray(request.input) || !boundaryId) return request;
  if (object(request.prompt_cache_options) && request.prompt_cache_options.mode === "explicit") return request;
  const boundary = ctx.sessionManager.getBranch().find((entry) => entry.id === boundaryId);
  if (boundary?.type !== "message" || boundary.message.role !== "user" || typeof boundary.message.content !== "string") return request;
  const boundaryText = boundary.message.content;
  const input = request.input;
  const matches = input.flatMap((item, index) => object(item) && item.role === "user" && Array.isArray(item.content) &&
    item.content.some((block: unknown) => object(block) && block.type === "input_text" && block.text === boundaryText) ? [index] : []);
  if (matches.length !== 1) return request;
  // Respect existing breakpoint policy/limits rather than adding to it.
  if (input.some((item) => object(item) && Array.isArray(item.content) &&
    item.content.some((block: unknown) => object(block) && block.prompt_cache_breakpoint !== undefined))) return request;

  for (let i = matches[0] - 1; i >= 0; i--) {
    const item = input[i];
    if (!object(item) || item.role !== "user" || !Array.isArray(item.content)) continue;
    for (let j = item.content.length - 1; j >= 0; j--) {
      const block = item.content[j];
      if (!object(block) || block.type !== "input_text" || typeof block.text !== "string" || !block.text.length) continue;
      const content = [...item.content];
      content[j] = { ...block, prompt_cache_breakpoint: { mode: "explicit" } };
      const copied = [...input];
      copied[i] = { ...item, content };
      return { ...request, input: copied };
    }
  }
  return request;
}

/** Share OpenAI cache accounting across stints, never runtime session identity. */
export function assistantCachePayload(payload: unknown, ctx: ExtensionContext): Record<string, unknown> | undefined {
  if (ctx.model?.provider !== "openai" || ctx.model.api !== "openai-responses") return;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const request = payload as Record<string, unknown>;
  // Respect disabled caching/unsupported payloads rather than enabling caching.
  if (typeof request.prompt_cache_key !== "string" || typeof request.model !== "string") return;
  const marker = findMarker(ctx.sessionManager.getBranch());
  if (!marker) return;

  // Use the outgoing model ID (including routing), not the originally chosen one.
  // Hash paths to avoid disclosing them; stay below OpenAI's 64-character limit.
  const scope = JSON.stringify([marker.primaryPath, ctx.model.provider, request.model]);
  const key = "assistant:v1:" + createHash("sha256").update(scope).digest("hex").slice(0, 48);
  return inheritedBreakpoint({ ...request, prompt_cache_key: key }, ctx, marker.boundaryId);
}
