# Development and verification

Run commands from the project root.

## Automated checks

```bash
npm install
npm run typecheck
npm test
```

To run tests against an existing Pi installation without installing dependencies
in this project:

```bash
PI_PACKAGE_ROOT=/path/to/node_modules/@earendil-works/pi-coding-agent npm test
```

`PI_PACKAGE_ROOT` overrides test package resolution only. Normal typechecking uses
local development dependencies.

Tests use real Pi session managers and SDK sessions with a local test provider;
provider responses are mocked, with no provider requests or real credentials.
Coverage includes context projection, compaction/stint scoping, model activation,
summary approval, cancellation, and file reporting. Loading tests exercise both
the source package and a copied installation, ensuring helpers are not registered
as extensions.

## Verification status

- After the copy-time cost fix, all 23 automated tests and strict typechecking
  against Pi 1.5.0 passed. Cost regressions cover inherited assistant/tool costs,
  preserved content/tokens, unchanged primary data, persisted zero costs, and new
  assistant charges. The footer itself has not yet been verified live.
- Live round trips, including after the refactor using `-e`, confirmed phrase
  forwarding, session IDs, model attribution, and unavailable-Git coverage warnings.
- A subsequent round trip recalled the primary fact “42 is the answer.” This is
  consistent with context inheritance after primary compaction, but the session
  file has not been inspected to confirm that compaction actually occurred.

The separate summary-generation request is not currently recorded in session usage
entries, so its cost is absent from totals. Recording that usage is a separate
accounting follow-up, not part of the inherited-cost fix.

## Remaining live checks

- Verify strict summary scoping with distinct primary-only and assistant-only facts.
  One summary described inherited testing instructions; wording alone does not
  establish a leak. Inspect the stint transcript and summary input if it recurs.
- Verify compaction inside an assistant stint, including a boundary removed from
  visible context, and context-edit fidelity.
- Exercise cancellation and Git-based reporting, including already-dirty files and
  edits committed during the stint. These paths have automated regression coverage.
