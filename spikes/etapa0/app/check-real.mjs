// SPIKE — risk 3 against the real test project (anonymous user only).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const C = "http://localhost:47100";
const ANON = process.env.CHECK_ANON_KEY || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function step(name, fn, wait = 2500) {
  await fetch(`${C}/reset`);
  await sleep(600);
  await fetch(`${C}/reset`);
  await fn();
  await sleep(wait);
  const a = await (await fetch(`${C}/dump?name=real-${name}`)).json();
  const file = new URL(`../out/real-${name}.appmap.json`, import.meta.url);
  const raw = readFileSync(file, "utf8");
  const appmap = JSON.parse(raw);
  const leaks = {
    anonKey: ANON.length > 20 && raw.includes(ANON),
    anonKeyPrefix40: ANON.length > 40 && raw.includes(ANON.slice(-40)),
    bearer: /Bearer\s+ey/i.test(raw),
    accessTokenField: /"access_token"\s*:\s*"ey/.test(raw),
  };
  console.log(`\n=== ${name}  (${a.events} eventos, vazamentos: ${JSON.stringify(leaks)})`);
  const byId = new Map(appmap.events.map((e) => [e.id, e]));
  for (const e of appmap.events) {
    if (e.event !== "call") continue;
    if (e.http_client_request && /supabase\.co/.test(e.http_client_request.url)) {
      const ret = appmap.events.find((r) => r.event === "return" && r.parent_id === e.id);
      const q = (e.message || []).map((m) => `${m.name}=${m.value}`).join("&");
      console.log(`  [${e.layer}] ${e.http_client_request.request_method} ${new URL(e.http_client_request.url).pathname}${q ? "?" + q.slice(0, 80) : ""}`);
      console.log(`      quem: ${JSON.stringify(e.supabase)} | status: ${ret?.http_client_response?.status_code ?? "?"} | resposta: ${(ret?.http_client_response?.return_value?.value || "").slice(0, 90)}${ret?.http_client_response?.headers?.["sb-request-id"] ? " | sb-request-id ✓" : ""}`);
      let p = byId.get(e.parent_id), chain = [];
      while (p) { chain.unshift(p.method_id || p.http_server_request?.path_info || "?"); p = byId.get(p.parent_id); }
      console.log(`      cadeia: ${chain.join(" > ")}`);
    }
    if (e.defined_class === "Realtime") console.log(`  [ws ${e.method_id}] ${e.message?.[0]?.value?.slice(0, 110)}`);
  }
}

await step("C-lista-deslogado", async () => {
  await page.goto("http://localhost:3100", { waitUntil: "networkidle" });
  await page.waitForFunction(() => /\d+ itens/.test(document.querySelector("#lista-cliente")?.textContent || ""));
}, 4000);
await step("D-edge-function", async () => {
  await page.click("#boas-vindas");
  await page.waitForFunction(() => document.querySelector("#extras-saida")?.textContent !== "");
});
await step("E-avatar-anonimo", async () => {
  await page.evaluate(() => (document.querySelector("#extras-saida").textContent = ""));
  await page.click("#avatar");
  await page.waitForFunction(() => document.querySelector("#extras-saida")?.textContent !== "");
});
await step("rpc", async () => {
  await page.evaluate(() => (document.querySelector("#extras-saida").textContent = ""));
  await page.click("#total");
  await page.waitForFunction(() => document.querySelector("#extras-saida")?.textContent !== "");
});
await step("B-insert-anonimo", async () => {
  await page.evaluate(() => (document.querySelector("#mensagem").textContent = ""));
  await page.click("#adicionar");
  await page.waitForFunction(() => document.querySelector("#mensagem")?.textContent !== "");
});
console.log("\nTela:", {
  lista: await page.textContent("#lista-cliente"),
  extras: await page.textContent("#extras-saida"),
  mensagem: await page.textContent("#mensagem"),
});
console.log("erros na página:", errors);
await browser.close();
