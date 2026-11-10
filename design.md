# Assistant Session — Implemented Design

Extension v0.6, developed and tested with **Pi 1.5.0**; compatibility with other
Pi versions is unverified. This document describes the current implementation.
See [README.md](./README.md) for installation and usage, and
[tests/README.md](./tests/README.md) for development and validation status.

## Purpose and boundaries

Run side questions in a separate session on a configured, typically cheaper model.
The assistant inherits the primary's effective context without adding its full Q&A
to the primary. Only an approved note and a file-change report flow back.

Every `/assistant` from a primary creates a fresh session. There is no delta sync,
reuse of earlier assistant Q&A, or cross-stint memory beyond findings already
returned to the primary. Sessions share the working directory; this is context
separation, not filesystem or tool isolation. Cache savings are provider-dependent,
not a correctness guarantee.

For native OpenAI Responses requests in assistant mode, `before_provider_request`
replaces an existing `prompt_cache_key` with a stable, bounded hash scoped to the
primary file path, provider, and outgoing model ID. Pi session IDs, connection
identity, retention settings, and primary requests remain untouched. Other
providers/APIs and requests without a cache key are left alone.

For GPT-prefixed model IDs whose Pi compatibility metadata sets
`supportsExplicitPromptCacheMode`, an experimental explicit breakpoint marks the
last eligible inherited user `input_text` block before the persisted stint boundary.
Input text is unchanged and implicit caching remains enabled. Missing/ambiguous
boundaries, missing eligible text, explicit-only mode, or existing breakpoints skip
annotation. The annotation changes only the outgoing payload, never stored session
history. A live three-stint Luna sequence confirmed provider acceptance and
substantial cross-stint reuse on both warm requests; other GPT models remain
unverified. Cache keys and breakpoints do not guarantee hits under other conditions.

## Opening an assistant

1. Wait for the agent to be idle and require an existing primary session file.
2. Resolve the saved model, or prompt for an available authenticated replacement.
3. Snapshot repository file contents and modes for later comparison.
4. Use `SessionManager.create()` in the primary's session directory, recording the
   primary path as `parentSession`. Prepare the session **before activation**:
   copy projected context, append a stint-boundary message and bookkeeping marker,
   then append model selection and the `assistant — <primary name>` display name.
5. Activate it with `ctx.switchSession()`. The fresh instance's `session_start`
   attempts to apply the configured model if a CLI override defeated restoration.
6. In `withSession`, verify the live model. A mismatch reports an error and attempts
   to return to the primary; a cancelled initial switch deletes the prepared file.

A persistent status identifies assistant mode and the live selected model, updating
on model changes. `/assistant` inside an assistant session acts as `/primary`.
Opening an assistant does not append entries to the primary transcript.

## Context copying and compaction

Copy `buildSessionProjection().messages`, not raw primary entries. This preserves
context edits and omissions, effective compaction summaries and their system
checkpoints, custom messages, and branch findings without resurrecting suppressed
history. New entries receive local IDs; compaction and branch pointers are rebuilt
through public append APIs rather than copied as cross-file references.

Copied assistant and tool-result messages have billing costs reset to zero without
mutating the primary. Content and token metadata remain intact for context
estimation. New assistant usage counts normally; inherited token counters still
appear in cumulative totals. Existing session files are not migrated. The separate
summary-generation request is not currently persisted in session usage totals.

The boundary separates inherited context from the assistant's new exchanges.
For return summaries, take raw active-branch entries after that boundary, exclude
compaction entries, rebuild a linear projection with context edits applied, and
exclude system messages. Raw entries retain earlier stint exchanges even after
compaction removes them from the visible model context. Mixed primary/assistant
compaction summaries are not used as summary input.

If the boundary is absent, including older sessions or tree navigation away from
it, automatic summarization is unavailable; a manual note remains possible.
This scopes the transcript supplied to the summarizer, not the origin of every
fact: an assistant reply can legitimately repeat inherited primary information.

## Returning to the primary

1. Wait for idle; find the assistant marker and check that the primary file exists.
2. Offer a tool-free summary through `ctx.modelRegistry.complete()` on the current
   selected model. Supply only the projected stint transcript as serialized data,
   with a 60-second timeout and a 1,024-token output limit. While the request
   runs, the extension's footer status slot shows a ticking elapsed-time
   indicator ("summarizing stint…"); the persistent assistant-mode status is
   restored afterwards, and UI-less modes skip the indicator.
3. Require a normally finished, non-empty response. An exact `Nothing substantive.`
   response skips the note; other drafts open in an editor for approval or editing.
   Declining, discarding, or failing generation allows a manual note instead.
4. Take the final file snapshot after review and build the coverage-qualified report.
5. Switch to the saved primary path. Only the successful switch's fresh
   `withSession` context appends the visible flow-back custom message. A cancelled
   return appends nothing; returning does not trigger a primary model turn.

The report is sent even without a note. Flow-back text identifies the source
session ID and live selected model; approved generated summaries also identify
the response model. Details retain the source session path, note, and changed
paths. Discarded drafts do not retain generated-summary attribution. Pi exposes
the custom message to the primary model as user-role context; attribution is
extension-supplied, not authenticated inter-model messaging.

## File-change reporting

Compare start/end fingerprints for tracked and non-ignored untracked repository
files: SHA-256 contents plus executable bits for regular files, targets for
symlinks. Snapshots are version 2. Tracked files from `git ls-files` are seeded
as clean sentinels; `git status --porcelain -z` — backed by the index stat
cache, so it never reads unchanged file contents — selects the only paths worth
hashing: dirty and non-ignored untracked files. Candidates are hashed with
bounded concurrency instead of one stream at a time, so the end snapshot costs
work proportional to changed files, not repository size.

Comparison semantics are unchanged: sentinel-versus-hash inequality still reports
modifications (including already-dirty files reverted to committed content
during the stint), absent keys still report additions and deletions, and this
still detects net changes for edits committed during the stint without assigning
authorship. New caveats: changes invisible to Git status (assume-unchanged or
skip-worktree entries, executable-bit-only changes where `core.fileMode` is
false) may be missed. Markers predating version 2 hold full-hash snapshots;
returns from those sessions re-hash everything in the legacy format for a
comparable baseline, and mixed formats report detection unavailable rather than
spurious mass modification.

Ignored files, Git metadata, submodule contents, outside-repository paths, and
transient/reverted changes are excluded. Inspection errors produce warnings;
missing or incompatible Git baselines explicitly report unavailable detection,
never a clean bill of health. Mutating tools remain enabled, so the primary should
re-read relevant files.

## Persistence and lifecycle

- Model preference: `~/.pi/agent/assistant-session.json`, containing
  `{ "model": "provider/modelId" }`.
- Assistant history: ordinary Pi JSONL files alongside the primary, retained after
  return and available to resume. No automatic old-session cleanup is implemented.
- Marker: `assistant-session/primary-ref`, storing primary path/name/leaf ID,
  creation time, configured model, stint boundary ID, and initial file snapshot.
  The leaf ID and creation time are informational; there is no synchronization
  based on them. Return switches by primary file path, not by saved leaf ID.
- Flow-back message type: `assistant-session/flowback`.
- After replacement, old runtime objects are stale. Switch callbacks use the fresh
  context; only the new extension instance uses its own `pi.setModel()`.

## Code organization

| File | Responsibility |
| --- | --- |
| `assistant-session.ts` | Command and lifecycle registration |
| `lib/sessions.ts` | Session preparation, switching, and flow-back |
| `lib/context.ts` | Effective context copying and stint projection |
| `lib/cache.ts` | Stable assistant-only OpenAI request cache keys |
| `lib/cache-debug.ts` | Opt-in payload fingerprints without message text |
| `lib/models.ts`, `lib/config.ts` | Model selection, restoration, status, preference |
| `lib/summary.ts` | Isolated generation, approval, and manual fallback |
| `lib/files.ts` | Content snapshots and qualified reports |
| `lib/state.ts` | Persisted marker types, identifiers, and lookup |

TypeScript runs in-process through Pi's extension loader using public APIs; no
build step is required. `package.json` declares only `assistant-session.ts` under
`pi.extensions`, so helpers are not independently registered. Both `pi -e .` and
`pi -e ./assistant-session.ts` work; copied installations need the complete package.
