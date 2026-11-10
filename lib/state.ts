import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { FileSnapshot } from "./files.ts";

// Custom entry types saved in session JSONL files. Keep stable so existing sessions still load.
export const MARKER = "assistant-session/primary-ref";
export const FLOWBACK = "assistant-session/flowback";

/** Metadata stored in an assistant session so it knows how to return to the primary session. */
export interface AssistantSessionMarker {
  primaryPath: string;
  primaryName?: string;
  primaryLeafId: string | null;
  createdAt: string;
  model: string;
  /** ID of the user message that marks the start of the assistant stint. */
  boundaryId?: string;
  files?: FileSnapshot;
}

/** Find the most recent assistant marker in the active session branch. */
export function findMarker(entries: SessionEntry[]): AssistantSessionMarker | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== MARKER) continue;

    const data = entry.data as AssistantSessionMarker | undefined;
    if (data && typeof data.primaryPath === "string" && typeof data.model === "string") {
      return data;
    }
  }
  return undefined;
}
