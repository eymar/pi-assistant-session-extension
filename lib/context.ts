import { buildSessionProjection, type SessionEntry, type SessionManager, type SessionProjection } from "@earendil-works/pi-coding-agent";

/** Copy only effective projected messages, never raw edited/omitted entries. */
export function copyProjection(sm: SessionManager, projection: SessionProjection): void {
  for (const message of projection.messages) {
    switch (message.role) {
      case "compactionSummary":
        // A projected system checkpoint immediately precedes this summary.
        // appendCompaction captures it before replacing the preceding context.
        sm.appendCompaction(message.summary, null, message.tokensBefore);
        break;
      case "branchSummary":
        // Preserve the finding, but use only local tree pointers in the copy.
        sm.branchWithSummary(sm.getLeafId(), message.summary);
        break;
      case "custom":
        sm.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
        break;
      default:
        sm.appendMessage(message);
    }
  }
}

/** Re-project the active stint, without inherited history or mixed compaction summaries.
 * Raw active-branch entries survive compaction, so this also retains earlier stint
 * messages after the visible boundary has been compacted out of model context.
 */
export function stintMessages(branch: SessionEntry[], boundaryId: string | undefined) {
  const index = boundaryId ? branch.findIndex((entry) => entry.id === boundaryId) : -1;
  if (index < 0) return undefined;
  const entries = branch.slice(index + 1).filter((entry) => entry.type !== "compaction");
  const linear = entries.map((entry, i) => ({ ...entry, parentId: i ? entries[i - 1].id : null }));
  return buildSessionProjection(linear).messages.filter((message) => message.role !== "system");
}
