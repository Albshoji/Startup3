import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigMatcher, parseConfig } from "../dist/index.js";

test("default config records the whole project except dependencies and build output", () => {
  const m = new ConfigMatcher();
  assert.ok(m.matchFile("components/AddItem.tsx"));
  assert.ok(m.matchFile("app/page.tsx"));
  assert.equal(m.matchFile("node_modules/react/index.js"), undefined);
  assert.equal(m.matchFile(".next/server/chunk.js"), undefined);
  assert.equal(m.matchFile("supabase/functions/send-welcome/index.ts"), undefined);
  assert.equal(m.matchFile("../outside.ts"), undefined);
});

test("packages: first prefix wins; exclude by path fragment, name or Class.method (appmap.yml semantics)", () => {
  const m = new ConfigMatcher({
    packages: [
      { path: "lib", exclude: ["lib/generated", "formatarData", "Carrinho.total"], shallow: true },
      { path: "./components/" },
    ],
  });
  assert.equal(m.matchFile("app/page.tsx"), undefined, "app is not listed");
  assert.equal(m.matchFile("libx/a.ts"), undefined, "prefix is per folder");
  assert.equal(m.matchFile("lib/generated/types.ts"), undefined);
  const lib = m.matchFile("lib/precos.ts");
  assert.equal(lib.index, 0);
  assert.equal(lib.shallow, true);
  assert.equal(ConfigMatcher.isFunctionExcluded(lib, "formatarData"), true);
  assert.equal(ConfigMatcher.isFunctionExcluded(lib, "total", "Carrinho"), true);
  assert.equal(ConfigMatcher.isFunctionExcluded(lib, "adicionar", "Carrinho"), false);
  assert.equal(m.matchFile("components/AddItem.tsx").index, 1);
});

test("function labels from the package and from the top level", () => {
  const m = new ConfigMatcher({
    packages: [{ path: ".", functions: [{ name: "verificarLogin", label: "security.authentication" }] }],
    functions: [{ names: ["verificarLogin", "Api.log"], labels: ["log"] }],
  });
  const pkg = m.matchFile("lib/auth.ts");
  assert.deepEqual(ConfigMatcher.labelsFor(pkg, "verificarLogin").sort(), ["log", "security.authentication"]);
  assert.deepEqual(ConfigMatcher.labelsFor(pkg, "log", "Api"), ["log"]);
  assert.deepEqual(ConfigMatcher.labelsFor(pkg, "outra"), []);
});

test("parseConfig drops invalid parts and explains why", () => {
  const { config, problems } = parseConfig({ packages: [{ path: "app" }, { exclude: [] }], limits: { maxSeconds: 30, maxEvents: -1 } });
  assert.deepEqual(config.packages, [{ path: "app" }]);
  assert.deepEqual(config.limits, { maxSeconds: 30 });
  assert.equal(problems.length, 2);
  assert.equal(parseConfig([]).problems.length, 1);
});
