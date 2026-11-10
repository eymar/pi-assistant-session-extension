import { createHash } from "node:crypto";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { findMarker } from "./state.ts";

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyUserTextBlock(block: unknown): block is JsonObject & { text: string } {
  return (
    isPlainObject(block) &&
    block.type === "input_text" &&
    typeof block.text === "string" &&
    block.text.length > 0
  );
}

/** Check whether the active model and request support an explicit OpenAI prompt-cache breakpoint. */
function supportsExplicitCacheBreakpoint(request: JsonObject, ctx: ExtensionContext): boolean {
  const model = ctx.model;
  const compat = model?.compat as { supportsExplicitPromptCacheMode?: boolean } | undefined;
  const modelSupportsExplicitCache =
    model?.api === "openai-responses" && compat?.supportsExplicitPromptCacheMode === true;

  if (!modelSupportsExplicitCache) return false;
  if (typeof request.model !== "string" || !request.model.startsWith("gpt-")) return false;
  if (!Array.isArray(request.input)) return false;

  // Do not interfere if the caller already configured explicit cache mode.
  if (isPlainObject(request.prompt_cache_options) && request.prompt_cache_options.mode === "explicit") {
    return false;
  }

  return true;
}

/** Look up the text of the stint-boundary user message in the session branch. */
function findBoundaryMessageText(branch: SessionEntry[], boundaryId: string | undefined): string | undefined {
  if (!boundaryId) return undefined;

  const entry = branch.find((item) => item.id === boundaryId);
  if (entry?.type !== "message" || entry.message.role !== "user") return undefined;
  if (typeof entry.message.content !== "string") return undefined;

  return entry.message.content;
}

/**
 * Find the unique index in `request.input` that matches the stint-boundary user message.
 * Returns -1 if the boundary is missing or appears more than once.
 */
function findBoundaryInputIndex(input: unknown[], boundaryText: string): number {
  const matchingIndices: number[] = [];

  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (!isPlainObject(item) || item.role !== "user" || !Array.isArray(item.content)) continue;

    const hasBoundaryBlock = item.content.some(
      (block: unknown) => isNonEmptyUserTextBlock(block) && block.text === boundaryText,
    );
    if (hasBoundaryBlock) {
      matchingIndices.push(i);
    }
  }

  return matchingIndices.length === 1 ? matchingIndices[0] : -1;
}

/** Check whether any content block in `request.input` already defines a cache breakpoint. */
function hasExistingBreakpoint(input: unknown[]): boolean {
  return input.some(
    (item) =>
      isPlainObject(item) &&
      Array.isArray(item.content) &&
      item.content.some(
        (block: unknown) => isPlainObject(block) && block.prompt_cache_breakpoint !== undefined,
      ),
  );
}

/**
 * Place an explicit cache breakpoint on the last inherited user text block before the stint boundary.
 * This tells OpenAI to cache the shared primary-session prefix across separate assistant stints.
 */
function withInheritedBreakpoint(
  request: JsonObject,
  ctx: ExtensionContext,
  boundaryId: string | undefined,
): JsonObject {
  if (!supportsExplicitCacheBreakpoint(request, ctx)) return request;

  const boundaryText = findBoundaryMessageText(ctx.sessionManager.getBranch(), boundaryId);
  if (!boundaryText) return request;

  const input = request.input as unknown[];
  if (hasExistingBreakpoint(input)) return request;

  const boundaryIndex = findBoundaryInputIndex(input, boundaryText);
  if (boundaryIndex < 0) return request;

  // Walk backwards from just before the boundary to find the last inherited user text block.
  for (let itemIndex = boundaryIndex - 1; itemIndex >= 0; itemIndex--) {
    const item = input[itemIndex];
    if (!isPlainObject(item) || item.role !== "user" || !Array.isArray(item.content)) continue;

    for (let blockIndex = item.content.length - 1; blockIndex >= 0; blockIndex--) {
      const block = item.content[blockIndex];
      if (!isNonEmptyUserTextBlock(block)) continue;

      const updatedContent = [...item.content];
      updatedContent[blockIndex] = { ...block, prompt_cache_breakpoint: { mode: "explicit" } };

      const updatedInput = [...input];
      updatedInput[itemIndex] = { ...item, content: updatedContent };

      return { ...request, input: updatedInput };
    }
  }

  return request;
}

/**
 * Build a stable OpenAI prompt_cache_key scoped to the primary session path, provider, and outgoing model.
 * Hashing hides local filesystem paths and keeps the key under OpenAI's 64-character limit.
 */
function buildAssistantCacheKey(primaryPath: string, provider: string, outgoingModel: string): string {
  const scope = JSON.stringify([primaryPath, provider, outgoingModel]);
  const hash = createHash("sha256").update(scope).digest("hex").slice(0, 48);
  return `assistant:v1:${hash}`;
}

/**
 * Rewrite an outgoing OpenAI Responses payload in assistant sessions so multiple stints
 * from the same primary session share prompt-cache keys and inherited-context breakpoints.
 */
export function assistantCachePayload(
  payload: unknown,
  ctx: ExtensionContext,
): Record<string, unknown> | undefined {
  if (ctx.model?.provider !== "openai" || ctx.model.api !== "openai-responses") return undefined;
  if (!isPlainObject(payload)) return undefined;

  // Only rewrite when Pi has already enabled prompt caching on the outgoing request.
  if (typeof payload.prompt_cache_key !== "string" || typeof payload.model !== "string") {
    return undefined;
  }

  const marker = findMarker(ctx.sessionManager.getBranch());
  if (!marker) return undefined;

  const cacheKey = buildAssistantCacheKey(marker.primaryPath, ctx.model.provider, payload.model);
  const requestWithKey = { ...payload, prompt_cache_key: cacheKey };

  return withInheritedBreakpoint(requestWithKey, ctx, marker.boundaryId);
}
