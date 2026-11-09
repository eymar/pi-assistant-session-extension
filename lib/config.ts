import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".pi", "agent");
const CONFIG_FILE = join(CONFIG_DIR, "assistant-session.json");

export function readConfiguredModel(): string | undefined {
  try {
    const value = JSON.parse(readFileSync(CONFIG_FILE, "utf8"))?.model;
    return typeof value === "string" && /^[^/]+\/.+/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeConfiguredModel(model: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ model }, null, 2) + "\n");
}
