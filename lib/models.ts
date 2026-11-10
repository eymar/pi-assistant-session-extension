import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readConfiguredModel, writeConfiguredModel } from "./config.ts";

type Model = NonNullable<ExtensionContext["model"]>;

export interface ModelRef {
  provider: string;
  id: string;
}

export function modelName(model: ModelRef | undefined): string {
  return model ? `${model.provider}/${model.id}` : "unavailable";
}

function findModel(ctx: ExtensionContext, reference: string): Model | undefined {
  const slashIndex = reference.indexOf("/");
  if (slashIndex < 0) return undefined;

  const provider = reference.slice(0, slashIndex);
  const id = reference.slice(slashIndex + 1);
  return ctx.modelRegistry.find(provider, id);
}

function isModelUsable(ctx: ExtensionContext, model: Model | undefined): model is Model {
  return Boolean(model && ctx.modelRegistry.hasConfiguredAuth(model));
}

/** Return the saved assistant model if usable, otherwise prompt the user to pick one. */
export async function selectAssistantModel(ctx: ExtensionCommandContext): Promise<Model | undefined> {
  const configuredRef = readConfiguredModel();
  const savedModel = configuredRef ? findModel(ctx, configuredRef) : undefined;
  if (isModelUsable(ctx, savedModel)) return savedModel;

  return promptForAssistantModel(ctx);
}

async function promptForAssistantModel(ctx: ExtensionCommandContext): Promise<Model | undefined> {
  const available = ctx.modelRegistry.getAvailable();
  if (available.length === 0) {
    ctx.ui.notify("No models available — configure a provider first.", "error");
    return undefined;
  }

  const providers = [...new Set(available.map((m) => m.provider))].sort();
  const provider = await ctx.ui.select("Assistant model — provider:", providers);
  if (!provider) return undefined;

  const modelIds = available
    .filter((m) => m.provider === provider)
    .map((m) => m.id)
    .sort();
  const id = await ctx.ui.select("Assistant model — model:", modelIds);
  if (!id) return undefined;

  const selected = ctx.modelRegistry.find(provider, id);
  if (!isModelUsable(ctx, selected)) {
    ctx.ui.notify("Selected model is unavailable or authentication is not configured.", "error");
    return undefined;
  }

  writeConfiguredModel(modelName(selected));
  return selected;
}

/**
 * Ensure the active session uses the marker's model.
 * Needed on session_start because a CLI --model flag can override the model stored in the session file.
 */
export async function restoreAssistantModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  reference: string,
): Promise<void> {
  if (modelName(ctx.model) === reference) return;

  const selected = findModel(ctx, reference);
  try {
    if (!selected || !(await pi.setModel(selected))) {
      ctx.ui.notify(`Could not activate assistant model ${reference}.`, "error");
    }
  } catch (error) {
    ctx.ui.notify(`Could not activate assistant model: ${String(error)}`, "error");
  }
}
