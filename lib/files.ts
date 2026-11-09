import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface FileSnapshot {
  root?: string;
  files: Record<string, string>;
  warnings: string[];
}

/** Net content/mode changes across tracked and non-ignored untracked files. */
export async function snapshotFiles(cwd: string): Promise<FileSnapshot> {
  const snapshot: FileSnapshot = { files: Object.create(null), warnings: [] };
  const git = (args: string[], directory = cwd) => execFileSync("git", args, {
    cwd: directory, encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    snapshot.root = git(["rev-parse", "--show-toplevel"]).trimEnd();
    const paths = new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], snapshot.root)
      .split("\0").filter(Boolean));
    for (const path of paths) {
      try {
        const absolute = join(snapshot.root, path);
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
        }
      }
    }
  } catch (error) {
    snapshot.warnings.push(`Git-based file reporting unavailable: ${String(error)}`);
  }
  return snapshot;
}

export function fileChangeReport(before: FileSnapshot | undefined, after: FileSnapshot): { changed: string[]; text: string } {
  const warnings = [...(before?.warnings ?? []), ...after.warnings];
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
      "Ignored files, Git metadata, submodule contents, outside-repository paths, and transient/reverted changes are not covered." +
      (warnings.length ? `\nPartial report — inspection warnings:\n${[...new Set(warnings)].join("\n")}` : ""),
  };
}
