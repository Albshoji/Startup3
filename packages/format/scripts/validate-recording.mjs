#!/usr/bin/env node
// Development tool: validates a Mapa recording (.appmap.json or .appmap.json.gz) with the
// AppMap validator (@appland/appmap-validate, MIT, allowed for tests: docs/decisions.md).
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validate } = require("@appland/appmap-validate");

const file = process.argv[2];
if (!file) {
  console.error("uso: validate-recording <arquivo.appmap.json[.gz]>");
  process.exit(2);
}
const raw = readFileSync(file);
const appmap = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
try {
  // The validator knows the schema up to 1.13.1 and checks the `version` value; 1.14 only adds optional metadata.
  validate({ ...appmap, version: "1.13.1" });
  console.log(`válido · version ${appmap.version} · ${appmap.events.length} eventos · parado por: ${appmap.metadata?.mapa?.stopped_by}`);
} catch (error) {
  console.error(`INVÁLIDO: ${error.message}`);
  process.exit(1);
}
