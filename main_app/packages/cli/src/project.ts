import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface NextProject {
  root: string;
  packageJson: PackageJson;
  nextVersion: string;
  nextMajor: number;
  nextBin: string;
}

export class MapaError extends Error {}

/** Finds the nearest package.json (from cwd upwards) that depends on `next`. */
export function findNextProject(cwd: string): NextProject {
  let dir = cwd;
  for (;;) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      const packageJson = JSON.parse(readFileSync(file, "utf8")) as PackageJson;
      if (packageJson.dependencies?.next || packageJson.devDependencies?.next) return resolveNext(dir, packageJson);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new MapaError(
    "Não encontrei um projeto Next.js nesta pasta. Rode o comando dentro da pasta do seu app (onde fica o package.json com o next).",
  );
}

function resolveNext(root: string, packageJson: PackageJson): NextProject {
  const require = createRequire(join(root, "package.json"));
  let nextPackage: string;
  try {
    nextPackage = require.resolve("next/package.json");
  } catch {
    throw new MapaError("O Next.js está no package.json, mas não está instalado. Rode `npm install` (ou pnpm/yarn) e tente de novo.");
  }
  const nextVersion = (JSON.parse(readFileSync(nextPackage, "utf8")) as PackageJson).version ?? "0.0.0";
  return {
    root,
    packageJson,
    nextVersion,
    nextMajor: Number(nextVersion.split(".")[0]),
    nextBin: join(dirname(nextPackage), "dist", "bin", "next"),
  };
}

export type Bundler = "turbopack" | "webpack";

/** Next 16 uses Turbopack by default (`--webpack` opts out); Next 15 uses webpack unless `--turbopack`. */
export function detectBundler(nextMajor: number, args: string[]): Bundler {
  if (args.includes("--webpack")) return "webpack";
  if (args.includes("--turbopack") || args.includes("--turbo")) return "turbopack";
  return nextMajor >= 16 ? "turbopack" : "webpack";
}

export const SUPPORTED_NEXT_MAJORS = [15, 16];
export const SUPPORTED_NODE_MAJORS = [22, 24];

export function nodeMajor(version = process.version): number {
  return Number(version.replace(/^v/, "").split(".")[0]);
}

/** Version of an installed dependency of the project, if any. */
export function installedVersion(root: string, name: string): string | undefined {
  try {
    const require = createRequire(join(root, "package.json"));
    return (JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")) as PackageJson).version;
  } catch {
    return undefined;
  }
}
