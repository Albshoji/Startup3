import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectBundler, findNextProject, MapaError, missingNodeRequirement } from "../dist/project.js";

test("Next 16 uses Turbopack unless --webpack; Next 15 uses webpack unless --turbopack", () => {
  assert.equal(detectBundler(16, []), "turbopack");
  assert.equal(detectBundler(16, ["--webpack"]), "webpack");
  assert.equal(detectBundler(15, []), "webpack");
  assert.equal(detectBundler(15, ["--turbopack"]), "turbopack");
});

test("finds the Next project and its installed version from a subfolder", () => {
  const example = fileURLToPath(new URL("../../../examples/next16-supabase-demo/app", import.meta.url));
  const project = findNextProject(example);
  assert.match(project.root, /next16-supabase-demo$/);
  assert.equal(project.nextMajor, 16);
  assert.match(project.nextBin, /next[\\/]dist[\\/]bin[\\/]next$/);
});

test("outside a Next project it explains what to do, in Portuguese", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mapa-cli-"));
  try {
    assert.throws(() => findNextProject(dir), (error) => error instanceof MapaError && /projeto Next\.js/.test(error.message));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Node versions too old for Babel 8 are reported with the minimum version", () => {
  assert.equal(missingNodeRequirement("v22.17.1"), "22.18");
  assert.equal(missingNodeRequirement("v22.18.0"), undefined);
  assert.equal(missingNodeRequirement("v24.10.0"), "24.11");
  assert.equal(missingNodeRequirement("v24.19.0"), undefined);
  assert.equal(missingNodeRequirement("v20.19.0"), "22.18");
  assert.equal(missingNodeRequirement("v26.0.0"), undefined);
});
