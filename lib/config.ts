import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".pi", "agent");
const CONFIG_FILE = join(CONFIG_DIR, "assistant-session.json");
const MODEL_REF_PATTERN = /^[^/]+\/.+/;

/** Read the saved "provider/modelId" preference from disk, or return undefined if missing or invalid. */
export function readConfiguredModel(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    const model = parsed?.model;
    return typeof model === "string" && MODEL_REF_PATTERN.test(model) ? model : undefined;
  } catch {
    return undefined;
  }
}

/** Save the chosen "provider/modelId" preference to disk for future assistant sessions. */
export function writeConfiguredModel(model: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ model }, null, 2) + "\n");
}
