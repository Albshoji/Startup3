import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function freshWithMapa(env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const key of Object.keys(env)) if (env[key] === undefined) delete process.env[key];
  try {
    delete require.cache[require.resolve("../dist/index.js")];
    return require("../dist/index.js").withMapa;
  } finally {
    process.env = saved;
  }
}

test("without MAPA=1 the config is returned untouched (same object)", () => {
  const withMapa = freshWithMapa({ MAPA: undefined });
  const config = { reactStrictMode: true };
  const saved = process.env.MAPA;
  delete process.env.MAPA;
  assert.equal(withMapa(config), config);
  const fn = () => config;
  assert.equal(withMapa(fn), fn);
  if (saved !== undefined) process.env.MAPA = saved;
});

test("with MAPA=1 registers browser and Node-server rules, keeps user config and rules", async () => {
  const withMapa = freshWithMapa({});
  process.env.MAPA = "1";
  process.env.MAPA_COLLECTOR_URL = "http://127.0.0.1:47100";
  try {
    const userRule = { loaders: ["svg-loader"], as: "*.js" };
    const out = withMapa({ reactStrictMode: true, env: { A: "1" }, turbopack: { rules: { "*.{js,jsx,ts,tsx,mjs,cjs}": userRule, "*.svg": { loaders: ["x"] } } } });
    assert.equal(out.reactStrictMode, true);
    assert.deepEqual(out.env, { A: "1", MAPA_COLLECTOR_URL: "http://127.0.0.1:47100" });
    const rules = out.turbopack.rules["*.{js,jsx,ts,tsx,mjs,cjs}"];
    assert.equal(rules.length, 3);
    assert.deepEqual(rules[0].condition, { all: ["browser", { not: "foreign" }] });
    assert.deepEqual(rules[1].condition, { all: [{ not: "browser" }, "node", { not: "foreign" }] });
    assert.equal(rules[0].loaders[0].options.layer, "browser");
    assert.match(rules[0].loaders[0].options.fingerprint, /^[0-9a-f]{16}$/);
    assert.equal(rules[1].loaders[0].options.layer, "server");
    assert.equal(rules[2], userRule);
    assert.ok(out.turbopack.rules["*.svg"]);

    const webpackConfig = (isServer, nextRuntime) => out.webpack({ module: { rules: [] } }, { isServer, nextRuntime });
    assert.equal(webpackConfig(false).module.rules[0].use[0].options.layer, "browser");
    assert.equal(webpackConfig(true, "nodejs").module.rules[0].use[0].options.layer, "server");
    assert.equal(webpackConfig(true, "edge").module.rules.length, 0, "edge runtime is skipped");

    const fromFn = await withMapa(async () => ({ basePath: "/x" }))("phase");
    assert.equal(fromFn.basePath, "/x");
    assert.ok(fromFn.turbopack.rules);
  } finally {
    delete process.env.MAPA;
    delete process.env.MAPA_COLLECTOR_URL;
  }
});

function runLoader(file, source, root, layer = "browser") {
  delete require.cache[require.resolve("../dist/loader.js")];
  const loader = require("../dist/loader.js");
  const deps = [];
  return new Promise((resolve) => {
    loader.call(
      {
        resourcePath: file,
        getOptions: () => ({ layer, root }),
        addDependency: (d) => deps.push(d),
        async: () => (error, code, map) => resolve({ error, code, map, deps }),
      },
      source,
      undefined,
    );
  });
}

test("loader: annotates project files, imports the right recorder, follows .mapa/config.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "mapa-loader-"));
  try {
    const file = join(root, "components", "AddItem.tsx");
    const source = 'export function formatarPreco(v: number) { return "R$ " + v; }\n';
    const browser = await runLoader(file, source, root, "browser");
    assert.equal(browser.error, null);
    assert.match(browser.code, /import "\.\.\/.*browser-runtime\/dist\/index\.js";/);
    assert.match(browser.code, /__mapa\.r\(this/);
    assert.ok(browser.map && browser.map.mappings, "source map is produced");
    const server = await runLoader(file, source, root, "server");
    assert.match(server.code, /server-runtime\/dist\/index\.js/);

    await mkdir(join(root, ".mapa"), { recursive: true });
    await writeFile(join(root, ".mapa", "config.json"), JSON.stringify({ packages: [{ path: "lib" }] }));
    const excluded = await runLoader(file, source, root);
    assert.equal(excluded.code, source, "components/ is not in the configured packages");
    assert.deepEqual(excluded.deps, [join(root, ".mapa", "config.json")], "config change triggers a rebuild");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loader: a file that cannot be parsed is returned unchanged (never breaks the app)", async () => {
  const root = await mkdtemp(join(tmpdir(), "mapa-loader-"));
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    const source = "export function quebrado( {";
    const result = await runLoader(join(root, "lib", "x.ts"), source, root);
    assert.equal(result.error, null);
    assert.equal(result.code, source);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = warn;
    await rm(root, { recursive: true, force: true });
  }
});
