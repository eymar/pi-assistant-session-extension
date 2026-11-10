import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** Version 2 (current): Git-status candidates plus clean sentinels.
 * Absent version: legacy snapshots that content-hashed every file. */
export interface FileSnapshot {
  version?: number;
  root?: string;
  files: Record<string, string>;
  warnings: string[];
}

const SNAPSHOT_VERSION = 2;
/** Sentinel for tracked files Git reports unchanged; never collides with fingerprints. */
const CLEAN = "clean";
const HASH_CONCURRENCY = 16;

/** Fingerprint one path into the snapshot; ENOENT removes any pre-seeded entry. */
async function fingerprint(root: string, path: string, snapshot: FileSnapshot): Promise<void> {
  try {
    const absolute = join(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      snapshot.files[path] = `symlink:${await readlink(absolute)}`;
    } else if (stat.isFile()) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(absolute)) hash.update(chunk);
      snapshot.files[path] = `file:${stat.mode & 0o111}:${hash.digest("hex")}`;
    } else {
      snapshot.warnings.push(`Not inspected (directory/submodule/special file): ${JSON.stringify(path)}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      snapshot.warnings.push(`Could not inspect ${JSON.stringify(path)}: ${String(error)}`);
    } else {
      delete snapshot.files[path];
    }
  }
}

/** Run async work over items with bounded concurrency. */
async function forEachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const item: T | undefined = items[index++];
      if (item === undefined) return;
      await work(item);
    }
  }));
}

/** Index-enumerated tracked files become clean sentinels; Git status (backed by
 * the index stat cache) names the only paths worth hashing: dirty and
 * non-ignored untracked files. Rename entries carry the original path in a
 * separate NUL field, which is consumed and ignored. */
function statusCandidates(status: string, tracked: string[], snapshot: FileSnapshot): string[] {
  for (const path of tracked) snapshot.files[path] = CLEAN;
  const candidates = new Set<string>();
  const fields = status.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    candidates.add(field.slice(3));
    if (field.startsWith("R")) i++; // original path of a rename
  }
  return [...candidates];
}

/** Net content/mode changes across tracked and non-ignored untracked files.
 * Only files Git reports as changed are content-hashed; legacy snapshots
 * (options.legacy, or markers predating version 2) hash every file instead. */
export async function snapshotFiles(cwd: string, options?: { legacy?: boolean }): Promise<FileSnapshot> {
  const snapshot: FileSnapshot = options?.legacy
    ? { files: Object.create(null), warnings: [] }
    : { version: SNAPSHOT_VERSION, files: Object.create(null), warnings: [] };
  const git = (args: string[], directory = cwd) => execFileSync("git", args, {
    cwd: directory, encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    snapshot.root = git(["rev-parse", "--show-toplevel"]).trimEnd();
    let paths: string[];
    if (snapshot.version === SNAPSHOT_VERSION) {
      paths = statusCandidates(
        git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], snapshot.root),
        git(["ls-files", "-z"], snapshot.root).split("\0").filter(Boolean),
        snapshot,
      );
    } else {
      paths = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], snapshot.root)
        .split("\0").filter(Boolean);
    }
    await forEachLimited(paths, HASH_CONCURRENCY, (path) => fingerprint(snapshot.root!, path, snapshot));
  } catch (error) {
    snapshot.warnings.push(`Git-based file reporting unavailable: ${String(error)}`);
  }
  return snapshot;
}

export function fileChangeReport(before: FileSnapshot | undefined, after: FileSnapshot): { changed: string[]; text: string } {
  const warnings = [...(before?.warnings ?? []), ...after.warnings];
  if (before && before.version !== after.version) {
    return {
      changed: [],
      text: "File-change detection unavailable: snapshot formats differ (pre-update snapshot). " +
        "Files may have changed; re-read relevant files before continuing." +
        (warnings.length ? `\n${[...new Set(warnings)].join("\n")}` : ""),
    };
  }
  if (!before?.root || !after.root || before.root !== after.root) {
    return {
      changed: [],
      text: "File-change detection unavailable: no comparable Git content snapshots. " +
        "Files may have changed; re-read relevant files before continuing." +
        (warnings.length ? `\n${[...new Set(warnings)].join("\n")}` : ""),
    };
  }
  const changed = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter((path) => before.files[path] !== after.files[path]).sort();
  const lines = changed.map((path) => {
    const kind = !(path in before.files) ? "added" : !(path in after.files) ? "deleted" : "modified";
    return `${kind}: ${JSON.stringify(path)}`;
  });
  return {
    changed,
    text: `Net file changes relative to ${JSON.stringify(after.root)}:\n${lines.join("\n") || "None detected."}\n` +
      "Coverage: tracked and non-ignored untracked files, contents, symlink targets, and executable bits. " +
      "Files Git reports unchanged are recorded as clean without content hashing, so changes invisible to Git status " +
      "(assume-unchanged/skip-worktree entries; executable-bit-only changes where Git ignores file modes) may be missed. " +
      "Ignored files, Git metadata, submodule contents, outside-repository paths, and transient/reverted changes are not covered." +
      (warnings.length ? `\nPartial report — inspection warnings:\n${[...new Set(warnings)].join("\n")}` : ""),
  };
}
