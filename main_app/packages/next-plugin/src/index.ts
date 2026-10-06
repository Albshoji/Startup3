// withMapa(nextConfig): the only line `mapa init` adds to the user's next.config.
// Without MAPA=1 it returns the config untouched (same object), so builds and production are
// identical to an app without Mapa. With MAPA=1 (set by `mapa dev`) it registers our Babel loader
// for browser and server code, the way LocatorJS does (referencias/locatorjs/packages/webpack-loader),
// instead of patching Next internals like appmap-node (referencias/appmap-node/src/hooks/next.ts).
// See docs/appmap-mapping.md §1 and docs/decisions.md.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoaderOptions } from "./types";

const LOADER = require.resolve("./loader");
const TURBOPACK_GLOB = "*.{js,jsx,ts,tsx,mjs,cjs}";
const WEBPACK_TEST = /\.(js|jsx|ts|tsx|mjs|cjs)$/;

type AnyConfig = Record<string, any>;
type ConfigFunction<T> = (...args: any[]) => T | Promise<T>;

interface WebpackContext {
  isServer: boolean;
  nextRuntime?: "nodejs" | "edge";
  [key: string]: unknown;
}

export function withMapa<T extends AnyConfig>(config: T): T;
export function withMapa<T extends AnyConfig>(config: ConfigFunction<T>): ConfigFunction<T>;
export function withMapa<T extends AnyConfig>(config: T | ConfigFunction<T>): T | ConfigFunction<T> {
  if (process.env.MAPA !== "1") return config;
  if (typeof config === "function") return async (...args: unknown[]) => applyMapa(await config(...args));
  return applyMapa(config);
}

function applyMapa<T extends AnyConfig>(nextConfig: T): T {
  const root = process.cwd();
  const fingerprint = computeFingerprint(root);
  const options = (layer: LoaderOptions["layer"]): LoaderOptions => ({ layer, root, fingerprint });

  // Turbopack: one rule for browser code and one for Node server code (the edge runtime has no
  // node:http / AsyncLocalStorage support we can rely on, like appmap-node which skips it too).
  const turbopack = { ...(nextConfig.turbopack ?? {}) };
  const rules = { ...(turbopack.rules ?? {}) };
  const ours = [
    { condition: { all: ["browser", { not: "foreign" }] }, loaders: [{ loader: LOADER, options: options("browser") }] },
    { condition: { all: [{ not: "browser" }, "node", { not: "foreign" }] }, loaders: [{ loader: LOADER, options: options("server") }] },
  ];
  const existing = rules[TURBOPACK_GLOB];
  rules[TURBOPACK_GLOB] = existing ? [...ours, ...(Array.isArray(existing) ? existing : [existing])] : ours;
  turbopack.rules = rules;

  const userWebpack = nextConfig.webpack as ((config: AnyConfig, context: WebpackContext) => AnyConfig) | undefined;

  return {
    ...nextConfig,
    env: {
      ...(nextConfig.env ?? {}),
      ...(process.env.MAPA_COLLECTOR_URL ? { MAPA_COLLECTOR_URL: process.env.MAPA_COLLECTOR_URL } : {}),
    },
    turbopack,
    webpack(config: AnyConfig, context: WebpackContext) {
      if (userWebpack) config = userWebpack(config, context);
      if (context.nextRuntime === "edge") return config;
      // enforce "pre": our loader sees the original source, before Next's SWC loader.
      config.module.rules.push({
        test: WEBPACK_TEST,
        exclude: /node_modules/,
        enforce: "pre",
        use: [{ loader: LOADER, options: options(context.isServer ? "server" : "browser") }],
      });
      return config;
    },
  };
}

/** Changes when `.mapa/config.json` or the code of the loader/plugin changes. */
function computeFingerprint(root: string): string {
  const hash = createHash("sha256");
  for (const file of [join(root, ".mapa", "config.json"), LOADER, require.resolve("@mapa/babel-plugin")]) {
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update(`missing:${file}`);
    }
  }
  return hash.digest("hex").slice(0, 16);
}

export default withMapa;
