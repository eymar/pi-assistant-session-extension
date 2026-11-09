# Pi Assistant Session Extension

Ask side questions in a separate Pi session on a cheaper model, then bring back
reviewed findings. Developed and tested with **Pi 1.5.0**; compatibility with other
versions is unverified.

## Run or install

From this project directory, launch without installing:

```bash
pi -e ./assistant-session.ts
# or: pi -e .
```

To register this directory permanently:

```bash
pi install "$(pwd)"
```

Use `/reload` after updating a registered installation. Keep the entry file and
`lib/` together; do not copy the entry file alone. If upgrading from a single-file
installation, remove the old installed copy to avoid duplicate commands.

## Use

1. Send a message in your primary session so it is saved.
2. Run **`/assistant`**. On first use, select an available provider and model.
3. Ask your side questions. The **⚡ ASSISTANT** status shows the active model.
4. Run **`/primary`** to return. You can generate a summary, edit and approve it,
   or discard it. A manual note is available if you skip or discard generation,
   or generation fails.

`/assistant` inside an assistant session also returns to the primary. Returning
appends the approved note and file report; send your next message to continue work.

## Model configuration

The selection is saved in `~/.pi/agent/assistant-session.json`:

```json
{ "model": "provider/modelId" }
```

Edit it to change the default for new assistant sessions, or delete it to choose
again on the next `/assistant`.

## Keep in mind

- Each visit starts a fresh assistant session with the primary's current context.
  Only findings you pass back carry over to future visits.
- Both sessions can edit the same files. The Git-based change report is best-effort
  and excludes ignored files and changes outside the repository. Outside Git,
  detection is unavailable. Re-read relevant files before continuing.
- Assistant session files remain saved and can be reopened through `/resume`.

See [design.md](./design.md) for implementation details and
[tests/README.md](./tests/README.md) for development and verification.
