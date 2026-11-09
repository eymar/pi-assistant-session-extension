# Development and verification

Run commands from the project root:

```bash
npm install
npm run typecheck
npm test
```

To run tests against an existing Pi installation without installing dependencies:

```bash
PI_PACKAGE_ROOT=/path/to/node_modules/@earendil-works/pi-coding-agent npm test
```

`PI_PACKAGE_ROOT` overrides test package resolution only. Normal typechecking uses
local development dependencies.

## Automated coverage

The 37 tests use real Pi session managers/SDK sessions and mocked provider responses;
no provider requests or real credentials are used. Coverage includes:

- Context projection, edits/omissions, branch findings, and compaction/stint scope.
- Model restoration, summary approval/fallback, and cancelled switches.
- Content-aware Git reporting and unavailable/partial coverage.
- Source-package and copied-installation loading.
- Inherited cost removal without changing primary data or token metadata.
- Stable cache keys, capability-gated GPT breakpoint placement, unchanged text/retention/session IDs.
- Opt-in fingerprint privacy, prefix comparison, permissions, and failure isolation.

All 37 tests and strict typechecking against installed Pi 1.5.0 passed after the
breakpoint implementation. These automated checks do not prove provider cache hits.

## Live verification

Live round trips confirmed forwarding, session/model attribution, and file coverage
reports both outside Git and in a repository with no detected changes.

Before explicit breakpoints, fresh assistant stints repeatedly read only 3,260 cached
tokens. Fingerprints confirmed equal keys/settings and a large shared input prefix.
Comparisons against the primary's saved fork leaves found the copied projected
context and LLM conversion intact, excluding expected metadata differences.

After adding the inherited-context breakpoint for GPT-6 Luna, three fresh stints reported:

| Stint | Cache read | Cache write | Recorded cost (USD) |
| --- | ---: | ---: | ---: |
| First, warming | 3,260 | 144,487 | $0.018116275 |
| Second | 138,258 | 9,610 | $0.002626630 |
| Third | 147,824 | 3,040 | $0.001900040 |

All completed normally with the same cache key/model/settings and annotated input
blocks. The two warm stints reused about 93.5% and 98% of input. This demonstrates
reuse in this sequence, not guaranteed savings for other prompts, models, or gaps.
Costs are Pi's catalog estimates, not provider-confirmed invoice amounts.

## Cache fingerprint diagnostics

Opt in when launching Pi:

```bash
PI_ASSISTANT_CACHE_DEBUG=1 pi -e ./assistant-session.ts
```

Resume the same primary, then run two new Luna stints with one short question each,
returning without generated summaries. Keep tools/reasoning settings stable and
avoid compaction. Compare first-response usage in the session files, not cumulative
footer tokens (which include inherited token metadata).

JSON-line logs append to `<assistant-session-file>.cache-debug.log` beside Pi
session files. Restart without the environment variable to disable logging; remove
sidecars manually when no longer needed. No extra model requests are made.

Records contain session ID/time, model/cache key, JSON field/item hashes and sizes,
annotated `breakpointBlocks`, and cumulative input-prefix hashes every 4 KiB.
Compare keys/settings first, then the first differing item/field/prefix block.
Offsets are bytes, not provider tokens. No message text, tool arguments, or raw
payloads are logged; hashes still reveal equality and can permit value guessing.

Logging captures our hook after rewriting, not later handlers or OpenAI's hidden
rendered context. Sidecars use mode 0600 and refuse symlinks. Failures warn without
aborting the request. Breakpoints apply only to GPT-prefixed native OpenAI
Responses models whose Pi compatibility metadata enables explicit prompt-cache
mode. They skip missing/ambiguous boundaries, missing eligible text, explicit-only
mode, or existing breakpoints. Only Luna has live provider verification.

## Remaining checks and limitations

- Separate summary-generation usage is not persisted in session totals. Recording
  it remains an accounting follow-up; current totals exclude that request.
- Verify strict live summary scoping with distinct primary-only/assistant-only facts.
  Repeated inherited facts alone do not prove a leak; inspect actual summary input.
- Verify live compaction inside an assistant stint, including a boundary removed
  from visible context, and context-edit fidelity. Primary-fact recall after a
  reported compaction succeeded, but the compaction entry was not inspected.
- Exercise live cancellation and Git reports for already-dirty and committed edits.
- Test cache reuse after compaction, longer idle gaps, and other prompt/tool changes.
  Other GPT models have not been live-validated for the explicit breakpoint.
