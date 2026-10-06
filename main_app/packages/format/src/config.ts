// `.mapa/config.json`: same semantics as AppMap's `appmap.yml` `packages`
// (referencias/appmap-node/src/PackageMatcher.ts, src/config.ts), see docs/appmap-mapping.md §2.
import type { RecordingLimits } from "./types.js";

export const CONFIG_FILE = ".mapa/config.json";

export interface FunctionLabels {
  name?: string | string[];
  names?: string | string[];
  label?: string | string[];
  labels?: string | string[];
}

export interface PackageConfig {
  /** Folder or file, relative to the project root. The first package whose path is a prefix wins. */
  path: string;
  /** Path fragments (substring of the file path) or function names (`nome` or `Classe.metodo`). */
  exclude?: string[];
  /** Do not record calls from this package to itself (only the entry into it). */
  shallow?: boolean;
  functions?: FunctionLabels[];
}

export interface MapaConfig {
  name?: string;
  packages?: PackageConfig[];
  /** Labels applied in every package (AppMap only has them per package). */
  functions?: FunctionLabels[];
  limits?: Partial<RecordingLimits>;
  mask?: { fields?: string[] };
}

/** Folders never instrumented, whatever the config says (dependencies, build output, Mapa itself, Deno code). */
export const ALWAYS_EXCLUDED = ["node_modules/", ".next/", ".mapa/"];

export const DEFAULT_PACKAGES: PackageConfig[] = [
  { path: ".", exclude: ["node_modules", ".next", ".mapa", "public", "supabase/functions"] },
];

export interface MatchedPackage {
  index: number;
  shallow: boolean;
  exclude: string[];
  labels: Map<string, string[]>;
}

/** Decides, from the config, which files and functions are recorded and which labels they get. */
export class ConfigMatcher {
  private readonly packages: PackageConfig[];
  private readonly globalLabels: Map<string, string[]>;

  constructor(config: MapaConfig = {}) {
    this.packages = (config.packages?.length ? config.packages : DEFAULT_PACKAGES).map((pkg) => ({
      ...pkg,
      path: normalizePackagePath(pkg.path),
      exclude: (pkg.exclude ?? []).map(toForwardSlashes),
    }));
    this.globalLabels = labelMap(config.functions);
  }

  /** `relPath` is relative to the project root, with forward slashes. */
  matchFile(relPath: string): MatchedPackage | undefined {
    const path = toForwardSlashes(relPath);
    if (path.startsWith("../") || path.startsWith("/")) return undefined;
    if (ALWAYS_EXCLUDED.some((dir) => path.startsWith(dir) || path.includes(`/${dir}`))) return undefined;
    const index = this.packages.findIndex((pkg) => pkg.path === "" || path === pkg.path || path.startsWith(`${pkg.path}/`));
    if (index < 0) return undefined;
    const pkg = this.packages[index]!;
    const exclude = pkg.exclude ?? [];
    if (exclude.some((fragment) => fragment && path.includes(fragment))) return undefined;
    const labels = new Map(this.globalLabels);
    for (const [name, list] of labelMap(pkg.functions)) labels.set(name, [...(labels.get(name) ?? []), ...list]);
    return { index, shallow: pkg.shallow === true, exclude, labels };
  }

  /** Function-level exclusion: by name or by `Class.method`, as in appmap-node `shouldSkipFunction`. */
  static isFunctionExcluded(pkg: MatchedPackage, name: string, klass?: string): boolean {
    return pkg.exclude.includes(name) || (klass !== undefined && pkg.exclude.includes(`${klass}.${name}`));
  }

  static labelsFor(pkg: MatchedPackage, name: string, klass?: string): string[] {
    const labels = [...(pkg.labels.get(name) ?? []), ...(klass ? (pkg.labels.get(`${klass}.${name}`) ?? []) : [])];
    return [...new Set(labels)];
  }
}

function labelMap(groups: FunctionLabels[] | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of groups ?? []) {
    const names = [...toArray(group.name), ...toArray(group.names)];
    const labels = [...toArray(group.label), ...toArray(group.labels)];
    for (const name of names) map.set(name, [...(map.get(name) ?? []), ...labels]);
  }
  return map;
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function toForwardSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function normalizePackagePath(path: string): string {
  const p = toForwardSlashes(path).replace(/^\.\/?/, "").replace(/\/+$/, "");
  return p;
}

/**
 * Validates a parsed config file. Returns the config and human-readable problems (in Portuguese,
 * shown to the end user). Invalid parts are dropped, never fatal.
 */
export function parseConfig(input: unknown): { config: MapaConfig; problems: string[] } {
  const problems: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { config: {}, problems: ["o arquivo .mapa/config.json não é um objeto JSON; usando a configuração padrão"] };
  }
  const raw = input as Record<string, unknown>;
  const config: MapaConfig = {};
  if (typeof raw.name === "string") config.name = raw.name;
  if (raw.packages !== undefined) {
    if (!Array.isArray(raw.packages)) problems.push('"packages" deve ser uma lista');
    else {
      config.packages = [];
      raw.packages.forEach((pkg: unknown, i) => {
        if (!pkg || typeof pkg !== "object" || typeof (pkg as PackageConfig).path !== "string") {
          problems.push(`packages[${i}] precisa de "path" (texto); ignorado`);
          return;
        }
        const p = pkg as PackageConfig;
        config.packages!.push({
          path: p.path,
          ...(Array.isArray(p.exclude) ? { exclude: p.exclude.filter((e) => typeof e === "string") } : {}),
          ...(typeof p.shallow === "boolean" ? { shallow: p.shallow } : {}),
          ...(Array.isArray(p.functions) ? { functions: p.functions } : {}),
        });
      });
    }
  }
  if (Array.isArray(raw.functions)) config.functions = raw.functions as FunctionLabels[];
  if (raw.limits && typeof raw.limits === "object") {
    const limits: Partial<RecordingLimits> = {};
    for (const key of ["maxSeconds", "maxEvents", "maxMegabytes", "maxCallsPerFunctionPerAction"] as const) {
      const value = (raw.limits as Record<string, unknown>)[key];
      if (typeof value === "number" && value > 0) limits[key] = value;
      else if (value !== undefined) problems.push(`limits.${key} deve ser um número maior que zero; ignorado`);
    }
    config.limits = limits;
  }
  if (raw.mask && typeof raw.mask === "object" && Array.isArray((raw.mask as { fields?: unknown }).fields)) {
    config.mask = { fields: ((raw.mask as { fields: unknown[] }).fields).filter((f): f is string => typeof f === "string") };
  }
  return { config, problems };
}
