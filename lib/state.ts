import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { FileSnapshot } from "./files.ts";

// Stable identifiers: existing saved sessions must continue to work.
export const MARKER = "assistant-session/primary-ref";
export const FLOWBACK = "assistant-session/flowback";

export interface AssistantSessionMarker {
  primaryPath: string;
  primaryName?: string;
  primaryLeafId: string | null;
  createdAt: string;
  model: string;
  /** Optional for compatibility with sessions created by v0.5. */
  boundaryId?: string;
  files?: FileSnapshot;
}

export function findMarker(entries: SessionEntry[]): AssistantSessionMarker | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === MARKER) {
      const data = entry.data as AssistantSessionMarker | undefined;
      if (data && typeof data.primaryPath === "string" && typeof data.model === "string") return data;
    }
  }
  return undefined;
}
