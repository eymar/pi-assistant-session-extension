import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";

export interface FileSnapshot {
  version?: number;
  root?: string;
  files: Record<string, string>;
  warnings: string[];
}

export interface FileChangeReport {
  changed: string[];
  text: string;
}

const SNAPSHOT_VERSION = 2;
/** Marker for tracked files that Git status reports as unchanged. */
const CLEAN_SENTINEL = "clean";
const HASH_CONCURRENCY = 16;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const COVERAGE_NOTE =
  "Coverage: tracked and non-ignored untracked files, contents, symlink targets, and executable bits. " +
  "Files Git reports unchanged are recorded as clean without content hashing, so changes invisible to Git status " +
  "(assume-unchanged/skip-worktree entries; executable-bit-only changes where Git ignores file modes) may be missed. " +
  "Ignored files, Git metadata, submodule contents, outside-repository paths, and transient/reverted changes are not covered.";

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function hashFileContents(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * Inspect a single file or symlink and store its fingerprint in the snapshot.
 * If a tracked file was deleted (ENOENT), remove its pre-seeded "clean" entry.
 */
async function fingerprintPath(
  root: string,
  relativePath: string,
  snapshot: FileSnapshot,
): Promise<void> {
  try {
    const absolutePath = join(root, relativePath);
    const stat = await lstat(absolutePath);

    if (stat.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      snapshot.files[relativePath] = `symlink:${target}`;
    } else if (stat.isFile()) {
      const execBits = stat.mode & 0o111;
      const digest = await hashFileContents(absolutePath);
      snapshot.files[relativePath] = `file:${execBits}:${digest}`;
    } else {
      snapshot.warnings.push(
        `Not inspected (directory/submodule/special file): ${JSON.stringify(relativePath)}`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      delete snapshot.files[relativePath];
    } else {
      snapshot.warnings.push(`Could not inspect ${JSON.stringify(relativePath)}: ${String(error)}`);
    }
  }
}

/** Run async work over a list of items with at most `limit` tasks in flight at once. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await work(item);
    }
  });

  await Promise.all(workers);
}

/**
 * Parse `git status --porcelain=v1 -z` output into candidate paths to hash.
 * Each entry starts with a 2-character status and a space ("XY path").
 * Rename ("R") entries are followed by a second NUL-terminated field for the old path, which we skip.
 */
function parseStatusCandidatePaths(porcelainStatus: string): string[] {
  const candidates = new Set<string>();
  const fields = porcelainStatus.split("\0");

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;

    const path = field.slice(3);
    candidates.add(path);

    if (field.startsWith("R")) {
      i++; // Skip the original path of a rename.
    }
  }

  return [...candidates];
}

/**
 * Snapshot the repository state in `cwd`.
 * Tracked files start as "clean", and only files reported by `git status` as modified or untracked
 * are hashed on disk. This keeps snapshot time proportional to the number of dirty files.
 */
export async function snapshotFiles(cwd: string): Promise<FileSnapshot> {
  const snapshot: FileSnapshot = {
    version: SNAPSHOT_VERSION,
    files: Object.create(null),
    warnings: [],
  };

  try {
    const root = runGit(cwd, ["rev-parse", "--show-toplevel"]).trimEnd();
    snapshot.root = root;

    const trackedPaths = runGit(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
    for (const path of trackedPaths) {
      snapshot.files[path] = CLEAN_SENTINEL;
    }

    const statusOutput = runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const candidatePaths = parseStatusCandidatePaths(statusOutput);

    await runWithConcurrency(candidatePaths, HASH_CONCURRENCY, (path) =>
      fingerprintPath(root, path, snapshot),
    );
  } catch (error) {
    snapshot.warnings.push(`Git-based file reporting unavailable: ${String(error)}`);
  }

  return snapshot;
}

function formatUniqueWarnings(warnings: string[], prefix = ""): string {
  if (warnings.length === 0) return "";
  const unique = [...new Set(warnings)].join("\n");
  return `\n${prefix}${unique}`;
}

/** Compare before/after snapshots and build a human-readable summary for the primary session. */
export function fileChangeReport(
  before: FileSnapshot | undefined,
  after: FileSnapshot,
): FileChangeReport {
  const allWarnings = [...(before?.warnings ?? []), ...after.warnings];

  if (before && before.version !== after.version) {
    return {
      changed: [],
      text:
        "File-change detection unavailable: snapshot formats differ (pre-update snapshot). " +
        "Files may have changed; re-read relevant files before continuing." +
        formatUniqueWarnings(allWarnings),
    };
  }

  if (!before?.root || !after.root || before.root !== after.root) {
    return {
      changed: [],
      text:
        "File-change detection unavailable: no comparable Git content snapshots. " +
        "Files may have changed; re-read relevant files before continuing." +
        formatUniqueWarnings(allWarnings),
    };
  }

  const allPaths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  const changed = [...allPaths]
    .filter((path) => before.files[path] !== after.files[path])
    .sort();

  const changeLines = changed.map((path) => {
    if (!(path in before.files)) return `added: ${JSON.stringify(path)}`;
    if (!(path in after.files)) return `deleted: ${JSON.stringify(path)}`;
    return `modified: ${JSON.stringify(path)}`;
  });

  const summaryBody = changeLines.join("\n") || "None detected.";
  const warningSection = formatUniqueWarnings(
    allWarnings,
    "Partial report — inspection warnings:\n",
  );

  return {
    changed,
    text: `Net file changes relative to ${JSON.stringify(after.root)}:\n${summaryBody}\n${COVERAGE_NOTE}${warningSection}`,
  };
}
