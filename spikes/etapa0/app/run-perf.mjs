// SPIKE (Etapa 0) — performance/volume: same interactions with and without MAPA.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const label = process.argv[2];
const sessionSeconds = Number(process.argv[3] || 120);
const BASE = "http://localhost:3100";
const COLLECTOR = "http://localhost:47100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = { label };

const browser = await chromium.launch();
const page = await browser.newPage();

// warm up (compile routes) then measure loads
await page.goto(BASE, { waitUntil: "networkidle" });
await page.goto(BASE + "/api/hello?n=1");
const loads = [];
for (let i = 0; i < 3; i++) {
  const t = Date.now();
  await page.goto(BASE, { waitUntil: "networkidle" });
  loads.push(Date.now() - t);
}
out.loadMs = median(loads);
await sleep(1000);

// scenario B latency: click -> message on screen
const b = [];
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => (document.querySelector("#mensagem").textContent = ""));
  const t = await page.evaluate(() => performance.now());
  await page.click("#adicionar");
  await page.waitForFunction(() => document.querySelector("#mensagem").textContent.startsWith("Adicionado"));
  b.push((await page.evaluate(() => performance.now())) - t);
}
out.scenarioBms = Math.round(median(b));

// loop button (10k calls)
const loops = [];
for (let i = 0; i < 3; i++) {
  await page.click("#loop");
  await sleep(300);
  loops.push(Number(await page.textContent("#loop-ms")));
}
out.loop10kMs = median(loops);

// typing into the big list: time per keystroke render
const typing = [];
for (const ch of "produto 1") {
  const t = await page.evaluate(() => performance.now());
  await page.type("#busca", ch);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  typing.push((await page.evaluate(() => performance.now())) - t);
}
out.keystrokeMs = Math.round(median(typing));
await page.fill("#busca", "");

// 2-minute realistic session
await fetch(`${COLLECTOR}/reset`).catch(() => {});
await sleep(700);
await fetch(`${COLLECTOR}/reset`).catch(() => {});
const end = Date.now() + sessionSeconds * 1000;
let actions = 0;
while (Date.now() < end) {
  const step = actions % 6;
  if (step === 0) await page.click("#adicionar");
  if (step === 1) { await page.fill("#busca", ""); await page.type("#busca", "produto 1", { delay: 120 }); }
  if (step === 2) await page.click("#async");
  if (step === 3) await page.click("#alterar");
  if (step === 4) { await page.fill("#nome", ""); await page.type("#nome", "Banana", { delay: 120 }); }
  if (step === 5) await page.goto(BASE, { waitUntil: "networkidle" });
  actions++;
  await sleep(2500);
}
await sleep(2000);
out.sessionActions = actions;
try {
  const r = await (await fetch(`${COLLECTOR}/dump?name=perf-${label}-session`)).json();
  out.session = { events: r.events, calls: r.calls, byLayer: r.byLayer, mb: +(r.jsonBytes / 1e6).toFixed(2), gzMb: +(r.gzipBytes / 1e6).toFixed(3), top: r.topFunctions.slice(0, 8) };
} catch {}
out.memoryMb = Math.round((await page.evaluate(() => performance.memory?.usedJSHeapSize || 0)) / 1e6);
await browser.close();
writeFileSync(new URL(`../out/perf-${label}.json`, import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
