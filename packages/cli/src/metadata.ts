import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { BaseMetadata } from "@mapa/collector";
import { installedVersion, type NextProject } from "./project.js";
import { MAPA_VERSION } from "./version.js";

const FRAMEWORKS = ["next", "react", "@supabase/supabase-js", "@supabase/ssr"];

/** metadata block of the AppMap file (referencias/appmap/README.md, "metadata"). */
export function buildMetadata(project: NextProject): BaseMetadata {
  const frameworks = FRAMEWORKS.flatMap((name) => {
    const version = installedVersion(project.root, name);
    return version ? [{ name, version }] : [];
  });
  const git = readGit(project.root);
  return {
    app: project.packageJson.name ?? basename(project.root),
    language: { name: "javascript", engine: "Node.js", version: process.version },
    frameworks,
    client: { name: "mapa", url: "https://github.com/Albshoji/Startup3", version: MAPA_VERSION },
    recorder: { type: "remote", name: "mapa" },
    ...(git ? { git } : {}),
  };
}

function readGit(root: string): BaseMetadata["git"] | undefined {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const commit = git("rev-parse", "HEAD");
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    let repository = "";
    try {
      repository = withoutCredentials(git("remote", "get-url", "origin"));
    } catch {
      // repository without remote
    }
    const status = git("status", "--porcelain").split("\n").filter(Boolean);
    return { repository, branch, commit, status };
  } catch {
    return undefined;
  }
}

/** Never let a token embedded in a remote URL (https://user:token@host/...) reach a recording. */
function withoutCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url; // scp-like syntax (git@github.com:org/repo.git) has no password
  }
}
