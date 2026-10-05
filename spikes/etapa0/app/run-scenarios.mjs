// SPIKE (Etapa 0) — drives the test app in Chromium and asks the collector for an analysis.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3100";
const COLLECTOR = "http://localhost:47100";
const mode = process.argv[2] || "turbopack";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reset = () => fetch(`${COLLECTOR}/reset`);
const dump = async (name) => (await fetch(`${COLLECTOR}/dump?name=${mode}-${name}`)).json();
const results = {};

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

let t0 = Date.now();
await page.goto(BASE, { waitUntil: "networkidle" });
results.firstLoadMs = Date.now() - t0;
await sleep(1500);

async function scenario(name, action, waitMs = 1500) {
  await reset();
  await sleep(600);
  await reset();
  await action();
  await sleep(waitMs);
  results[name] = await dump(name);
}

// Scenario B: click "Adicionar item" -> handler -> supabase insert -> formatarPreco -> screen
await scenario("B-adicionar", async () => {
  await page.click("#adicionar");
  await page.waitForFunction(() => document.querySelector("#mensagem")?.textContent?.startsWith("Adicionado"));
});
results["B-adicionar"].screen = await page.textContent("#mensagem");

await scenario("server-action", async () => {
  await page.click("#alterar");
  await page.waitForFunction(() => document.querySelector("#mensagem")?.textContent === "Alterado");
});

await scenario("async-chain", async () => {
  await page.click("#async");
  await page.waitForFunction(() => document.querySelector("#async-resultado")?.textContent !== "");
});
results["async-chain"].screen = await page.textContent("#async-resultado");

await scenario("erro", async () => {
  await page.click("#erro");
});

await scenario("loop", async () => {
  await page.click("#loop");
  await page.waitForFunction(() => document.querySelector("#loop-ms")?.textContent !== "");
}, 2500);
results.loop.loopMs = Number(await page.textContent("#loop-ms"));

// Interleaving: two async flows started back to back
await scenario("concorrente", async () => {
  await page.click("#async");
  await page.click("#adicionar");
  await sleep(1500);
});

results.browserStats = await page.evaluate(() => window.__mapaStats);

// Hot reload: edit a client component and check the page updates without a full reload
if (process.argv.includes("--hmr")) {
  const file = new URL("./components/LoopButton.tsx", import.meta.url).pathname;
  const original = readFileSync(file, "utf8");
  await page.evaluate(() => (window.__hmrMarker = 42));
  writeFileSync(file, original.replace("Loop pesado", "Loop pesado (editado)"));
  const tHmr = Date.now();
  try {
    await page.waitForFunction(() => document.querySelector("#loop")?.textContent === "Loop pesado (editado)", null, { timeout: 30000 });
    results.hmr = {
      updated: true,
      ms: Date.now() - tHmr,
      fullReload: (await page.evaluate(() => window.__hmrMarker)) !== 42,
    };
  } catch (e) {
    results.hmr = { updated: false, error: e.message };
  } finally {
    writeFileSync(file, original);
  }
  await sleep(2000);
}

results.consoleErrors = consoleErrors;
writeFileSync(new URL(`../out/${mode}-scenarios.json`, import.meta.url), JSON.stringify(results, null, 2));
await browser.close();

const brief = {};
for (const [k, v] of Object.entries(results)) {
  if (v && typeof v === "object" && "events" in v) brief[k] = { events: v.events, calls: v.calls, byLayer: v.byLayer, kb: Math.round(v.jsonBytes / 1024), gzKb: Math.round(v.gzipBytes / 1024) };
  else brief[k] = v;
}
console.log(JSON.stringify(brief, null, 2));
