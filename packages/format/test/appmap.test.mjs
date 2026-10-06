import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildAppMap, APPMAP_VERSION } from "../dist/index.js";

const require = createRequire(import.meta.url);
const { validate } = require("@appland/appmap-validate");

// @appland/appmap-validate 2.5.1 knows the schema up to 1.13.1 and also checks the value of
// `version`. 1.14 only adds optional metadata (trimmed/sanitized), so a copy of the file with
// version 1.13.1 is validated (docs/decisions.md).
const VALIDATOR_VERSION = "1.13.1";
const validateAppMap = (appmap) => validate({ ...appmap, version: VALIDATOR_VERSION });

const metadata = {
  name: "teste",
  app: "demo",
  language: { name: "javascript", engine: "Node.js", version: process.version },
  frameworks: [{ name: "next", version: "16.3.8" }],
  client: { name: "mapa", url: "https://github.com/Albshoji/Startup3", version: "0.0.0" },
  recorder: { type: "remote", name: "mapa" },
  mapa: { started_at: new Date().toISOString(), stopped_by: "user" },
};

test("an empty recording is a valid AppMap", () => {
  const appmap = buildAppMap(metadata);
  assert.equal(appmap.version, APPMAP_VERSION);
  assert.doesNotThrow(() => validateAppMap(appmap));
});

test("the validator rejects a broken file (sanity check of the test itself)", () => {
  const broken = { ...buildAppMap(metadata), classMap: "not-a-list" };
  assert.throws(() => validateAppMap(broken));
});
