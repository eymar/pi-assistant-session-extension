import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readConfiguredModel, writeConfiguredModel } from "./config.ts";

type Model = NonNullable<ExtensionContext["model"]>;

export function modelName(model: { provider: string; id: string } | undefined): string {
  return model ? `${model.provider}/${model.id}` : "unavailable";
}

function findModel(ctx: ExtensionContext, reference: string): Model | undefined {
  const separator = reference.indexOf("/");
  return ctx.modelRegistry.find(reference.slice(0, separator), reference.slice(separator + 1));
}

/** Resolve saved configuration, prompting only if the model is unavailable. */
export async function selectAssistantModel(ctx: ExtensionCommandContext): Promise<Model | undefined> {
  const configured = readConfiguredModel();
  const saved = configured ? findModel(ctx, configured) : undefined;
  if (saved && ctx.modelRegistry.hasConfiguredAuth(saved)) return saved;

  const available = ctx.modelRegistry.getAvailable();
  if (!available.length) {
    ctx.ui.notify("No models available — configure a provider first.", "error");
    return undefined;
  }
  const providers = [...new Set(available.map((model) => model.provider))].sort();
  const provider = await ctx.ui.select("Assistant model — provider:", providers);
  if (!provider) return undefined;

  const ids = available.filter((model) => model.provider === provider).map((model) => model.id).sort();
  const id = await ctx.ui.select("Assistant model — model:", ids);
  if (!id) return undefined;

  const selected = ctx.modelRegistry.find(provider, id);
  if (!selected || !ctx.modelRegistry.hasConfiguredAuth(selected)) {
    ctx.ui.notify("Selected model is unavailable or authentication is not configured.", "error");
    return undefined;
  }
  writeConfiguredModel(modelName(selected));
  return selected;
}

/** Called only by the fresh extension instance, never from an old switch callback. */
export async function restoreAssistantModel(pi: ExtensionAPI, ctx: ExtensionContext, reference: string): Promise<void> {
  if (modelName(ctx.model) === reference) return;

  // Explicit CLI --model options override transcript restoration on every switch.
  // The new instance's pi.setModel is safe to use during session_start.
  const selected = findModel(ctx, reference);
  try {
    if (!selected || !await pi.setModel(selected)) {
      ctx.ui.notify(`Could not activate assistant model ${reference}.`, "error");
    }
  } catch (error) {
    ctx.ui.notify(`Could not activate assistant model: ${String(error)}`, "error");
  }
}

/** Stable footer status key owned by this extension. */
export const STATUS_KEY = "assistant-session";

export function updateAssistantStatus(ctx: ExtensionContext): void {
  ctx.ui.setStatus(STATUS_KEY, `⚡ ASSISTANT (${modelName(ctx.model)})`);
}
