/** Pi assistant sessions — registration only; implementation lives in lib/. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { assistantCachePayload } from "./lib/cache.ts";
import { logCacheFingerprint } from "./lib/cache-debug.ts";
import { modelName, restoreAssistantModel, updateAssistantStatus } from "./lib/models.ts";
import { openAssistant, returnToPrimary } from "./lib/sessions.ts";
import { findMarker } from "./lib/state.ts";

export default function assistantSessionExtension(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => {
    const payload = assistantCachePayload(event.payload, ctx);
    logCacheFingerprint(payload ?? event.payload, ctx);
    return payload;
  });

  pi.on("session_start", async (_event, ctx) => {
    const marker = findMarker(ctx.sessionManager.getBranch());
    if (!marker) return;

    await restoreAssistantModel(pi, ctx, marker.model);
    updateAssistantStatus(ctx);
    ctx.ui.notify(`⚡ Assistant session — selected model ${modelName(ctx.model)}; /primary to return`, "info");
  });

  pi.on("model_select", (_event, ctx) => {
    if (findMarker(ctx.sessionManager.getBranch())) updateAssistantStatus(ctx);
  });

  pi.registerCommand("primary", {
    description: "Return to the primary session, with optional reviewed findings",
    handler: async (_args, ctx) => returnToPrimary(ctx),
  });
  pi.registerCommand("assistant", {
    description: "Open a fresh assistant session with this session's projected context",
    handler: async (_args, ctx) => openAssistant(ctx),
  });
}
