import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { modelName } from "./models.ts";

/** Footer status slot owned by this extension. */
export const STATUS_KEY = "assistant-session";

export function updateAssistantStatus(ctx: ExtensionContext): void {
  ctx.ui.setStatus(STATUS_KEY, `⚡ ASSISTANT (${modelName(ctx.model)})`);
}

/** Show a ticking elapsed-time status while the summary request runs, then restore the assistant status. */
export async function withSummaryProgress<T>(
  ctx: ExtensionCommandContext,
  work: () => Promise<T>,
): Promise<T> {
  if (!ctx.hasUI) return work();

  const startTime = Date.now();
  const updateTimerStatus = () => {
    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
    ctx.ui.setStatus(STATUS_KEY, `⚡ ASSISTANT — summarizing stint… ${elapsedSeconds}s`);
  };

  updateTimerStatus();
  const timer = setInterval(updateTimerStatus, 1000);

  try {
    return await work();
  } finally {
    clearInterval(timer);
    updateAssistantStatus(ctx);
  }
}
