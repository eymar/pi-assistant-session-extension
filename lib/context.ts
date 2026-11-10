import {
  buildSessionProjection,
  type SessionEntry,
  type SessionManager,
  type SessionProjection,
} from "@earendil-works/pi-coding-agent";

type ProjectedMessage = SessionProjection["messages"][number];

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/** Reset dollar costs to zero while keeping token counts for context-window estimation. */
function withZeroCost<T extends { usage?: { cost?: unknown } }>(message: T): T {
  if (!message.usage) return message;
  return {
    ...message,
    usage: { ...message.usage, cost: { ...ZERO_COST } },
  };
}

/**
 * Copy the primary session's effective projected messages into a new assistant session.
 * Using the projection (rather than raw entries) preserves user context edits and omissions.
 */
export function copyProjection(target: SessionManager, projection: SessionProjection): void {
  for (const message of projection.messages) {
    switch (message.role) {
      case "compactionSummary":
        // A system checkpoint precedes this summary in the projection; appendCompaction captures it.
        target.appendCompaction(message.summary, null, message.tokensBefore);
        break;

      case "branchSummary":
        // Keep the branch summary text, linked to the local leaf in the new session.
        target.branchWithSummary(target.getLeafId(), message.summary);
        break;

      case "custom":
        target.appendCustomMessageEntry(
          message.customType,
          message.content,
          message.display,
          message.details,
        );
        break;

      case "assistant":
      case "toolResult":
        // Do not carry the primary session's billing cost into the assistant session.
        target.appendMessage(withZeroCost(message));
        break;

      default:
        target.appendMessage(message);
    }
  }
}

/**
 * Return projected messages from the assistant stint only (everything after boundaryId).
 * Compaction entries are removed so raw stint messages remain available even after compaction,
 * and mixed primary/assistant compaction summaries are never sent to the summarizer.
 */
export function stintMessages(
  branch: SessionEntry[],
  boundaryId: string | undefined,
): ProjectedMessage[] | undefined {
  if (!boundaryId) return undefined;

  const boundaryIndex = branch.findIndex((entry) => entry.id === boundaryId);
  if (boundaryIndex < 0) return undefined;

  const stintEntries = branch
    .slice(boundaryIndex + 1)
    .filter((entry) => entry.type !== "compaction");

  const linearEntries = stintEntries.map((entry, index) => ({
    ...entry,
    parentId: index > 0 ? stintEntries[index - 1].id : null,
  }));

  return buildSessionProjection(linearEntries).messages.filter(
    (message) => message.role !== "system",
  );
}
