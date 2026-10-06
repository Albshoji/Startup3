// webpack/Turbopack loader that runs @mapa/babel-plugin on the user's files. Registered by withMapa.
// Never breaks the app: if a file cannot be transformed, the original code is returned with a warning
// (same rule as appmap-node's transform and LocatorJS's loader).
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import type { MapaConfig } from "@mapa/format";
import type { LoaderOptions } from "./types";

interface LoaderContext {
  resourcePath: string;
  rootContext?: string;
  getOptions?(): LoaderOptions;
  async(): (error: Error | null, code?: string, map?: unknown) => void;
  addDependency?(file: string): void;
}

const RUNTIMES = {
  browser: require.resolve("@mapa/browser-runtime"),
  server: require.resolve("@mapa/server-runtime"),
};
const LOG = process.env.MAPA_LOADER_LOG;

let configCache: { file: string; mtimeMs: number; config: MapaConfig } | undefined;
const warned = new Set<string>();

function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[mapa] ${message}`);
}

/** Reads `.mapa/config.json` (re-read only when it changes). Missing file → default config. */
function loadConfig(root: string, format: typeof import("@mapa/format")): { config: MapaConfig; file: string; exists: boolean } {
  const file = join(root, format.CONFIG_FILE);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return { config: {}, file, exists: false };
  }
  if (configCache?.file === file && configCache.mtimeMs === mtimeMs) return { config: configCache.config, file, exists: true };
  let config: MapaConfig = {};
  try {
    const parsed = format.parseConfig(JSON.parse(readFileSync(file, "utf8")));
    config = parsed.config;
    for (const problem of parsed.problems) warnOnce(`${mtimeMs}:${problem}`, `.mapa/config.json: ${problem}`);
  } catch (error) {
    warnOnce(`${mtimeMs}:json`, `.mapa/config.json não é um JSON válido (${(error as Error).message}); usando a configuração padrão.`);
  }
  configCache = { file, mtimeMs, config };
  return { config, file, exists: true };
}

function importSpecifier(fromFile: string, target: string): string {
  let spec = relative(dirname(fromFile), target).split(sep).join("/");
  if (!spec.startsWith(".")) spec = `./${spec}`;
  return spec;
}

async function transform(this: LoaderContext, source: string, inputMap: unknown): Promise<{ code: string; map?: unknown }> {
  const options = this.getOptions?.() ?? ({ layer: "server", root: this.rootContext ?? process.cwd() } as LoaderOptions);
  const root = options.root || this.rootContext || process.cwd();
  const file = this.resourcePath;

  const format = await import("@mapa/format");
  const { config, file: configFile, exists } = loadConfig(root, format);
  if (exists) this.addDependency?.(configFile);

  const relPath = relative(root, file).split(sep).join("/");
  if (options.awaitsOnly) {
    if (!/\bawait\b/.test(source)) return { code: source, map: inputMap };
  } else if (!new format.ConfigMatcher(config).matchFile(relPath)) return { code: source, map: inputMap };

  const started = process.hrtime.bigint();
  const ext = extname(file);
  const typescript = [".ts", ".tsx", ".mts", ".cts"].includes(ext);
  const jsx = ![".ts", ".mts", ".cts"].includes(ext);
  const [babel, plugin] = await Promise.all([import("@babel/core"), import("@mapa/babel-plugin")]);
  const result = await babel.transformAsync(source, {
    filename: file,
    babelrc: false,
    configFile: false,
    browserslistConfigFile: false,
    sourceType: "unambiguous",
    sourceMaps: true,
    inputSourceMap: (inputMap as never) || undefined,
    parserOpts: { plugins: [...(typescript ? (["typescript"] as const) : []), ...(jsx ? (["jsx"] as const) : [])] },
    plugins: [[plugin.default as never, { layer: options.layer, root, config, awaitsOnly: options.awaitsOnly === true, runtimeImport: importSpecifier(file, RUNTIMES[options.layer]) }]],
  });
  if (LOG) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    (await import("node:fs")).appendFileSync(LOG, `${options.layer}${options.awaitsOnly ? "+awaits" : ""}\t${relPath}\t${ms.toFixed(1)}\n`);
  }
  if (!result?.code) return { code: source, map: inputMap };
  return { code: result.code, map: result.map ?? undefined };
}

function mapaLoader(this: LoaderContext, source: string, inputMap: unknown) {
  const callback = this.async();
  transform.call(this, source, inputMap).then(
    ({ code, map }) => callback(null, code, map),
    (error: Error) => {
      warnOnce(this.resourcePath, `não consegui gravar as funções de ${this.resourcePath}; o arquivo segue sem gravação. Motivo: ${error.message.split("\n")[0]}`);
      callback(null, source, inputMap);
    },
  );
}

export = mapaLoader;
