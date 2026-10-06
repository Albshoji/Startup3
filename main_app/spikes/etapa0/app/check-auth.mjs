// SPIKE — risk 3 with a logged-in user against the real test project.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const C = "http://localhost:47100";
const ANON = process.env.CHECK_ANON_KEY || "";
const stamp = Date.now();
const EMAIL = `mapa.teste.${stamp}@example.com`;
const PASSWORD = `Senha-${randomBytes(9).toString("hex")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const summary = { email: EMAIL.replace(/^[^@]+/, "mapa.teste.<ts>"), steps: {} };

async function step(name, fn, wait = 3000) {
  await fetch(`${C}/reset`);
  await sleep(600);
  await fetch(`${C}/reset`);
  await fn();
  await sleep(wait);
  await fetch(`${C}/dump?name=auth-${name}`);
  const raw = readFileSync(new URL(`../out/auth-${name}.appmap.json`, import.meta.url), "utf8");
  const appmap = JSON.parse(raw);
  const leaks = {
    senha: raw.includes(PASSWORD),
    email: raw.includes(EMAIL),
    jwt: /eyJ[\w-]{10,}\.[\w-]{10,}\./.test(raw),
    anonKey: ANON.length > 40 && raw.includes(ANON.slice(-40)),
  };
  const lines = [];
  const byId = new Map(appmap.events.map((e) => [e.id, e]));
  for (const e of appmap.events) {
    if (e.event !== "call") continue;
    if (e.http_client_request && /supabase\.co/.test(e.http_client_request.url) && !/realtime/.test(e.http_client_request.url)) {
      const ret = appmap.events.find((r) => r.event === "return" && r.parent_id === e.id);
      const body = (e.message || []).find((m) => m.name === "body")?.value || "";
      let p = byId.get(e.parent_id), chain = [];
      while (p) { chain.unshift(p.method_id || p.http_server_request?.path_info || "?"); p = byId.get(p.parent_id); }
      lines.push(`[${e.layer}] ${e.http_client_request.request_method} ${new URL(e.http_client_request.url).pathname} -> ${ret?.http_client_response?.status_code ?? "?"} | quem=${JSON.stringify(e.supabase)}`);
      if (body) lines.push(`    corpo enviado: ${body.slice(0, 110)}`);
      lines.push(`    resposta: ${(ret?.http_client_response?.return_value?.value || "").slice(0, 110)}`);
      lines.push(`    cadeia: ${chain.join(" > ")}`);
    }
    if (e.defined_class === "Realtime" && e.method_id === "receive" && /postgres_changes/.test(e.message?.[0]?.value || "")) lines.push(`[ws receive] ${e.message[0].value.slice(0, 110)}`);
    if (["cadastrar", "entrar"].includes(e.method_id)) lines.push(`[função ${e.method_id}] parâmetros: ${JSON.stringify(e.parameters)}`);
  }
  summary.steps[name] = { events: appmap.events.length, leaks, lines };
  console.log(`\n=== ${name} (${appmap.events.length} eventos) vazamentos=${JSON.stringify(leaks)}`);
  for (const l of lines) console.log("  " + l);
}

await page.goto("http://localhost:3100", { waitUntil: "networkidle" });
await sleep(1500);

await step("A-cadastro", async () => {
  await page.fill("#email", EMAIL);
  await page.fill("#senha-conta", PASSWORD);
  await page.click("#cadastrar");
  await page.waitForFunction(() => /cadastrado|erro/.test(document.querySelector("#conta-status")?.textContent || ""), null, { timeout: 20000 });
});
summary.userStatus = (await page.textContent("#conta-status")).replace(/[0-9a-f-]{36}/, (id) => ((summary.userId = id), "<id>"));

await step("B-adicionar-logado", async () => {
  await page.evaluate(() => (document.querySelector("#mensagem").textContent = ""));
  await page.click("#adicionar");
  await page.waitForFunction(() => document.querySelector("#mensagem")?.textContent !== "", null, { timeout: 20000 });
}, 5000);
summary.realtimeEvents = await page.textContent("#realtime-eventos");
summary.mensagem = await page.textContent("#mensagem");

await step("C-lista-logado", async () => {
  await page.goto("http://localhost:3100", { waitUntil: "networkidle" });
  await page.waitForFunction(() => /\d+ itens/.test(document.querySelector("#lista-cliente")?.textContent || ""));
}, 4000);
summary.listaServidor = await page.textContent("#lista-servidor");
summary.listaCliente = await page.textContent("#lista-cliente");

await step("E-avatar-logado", async () => {
  await page.evaluate(() => (document.querySelector("#extras-saida").textContent = ""));
  await page.click("#avatar");
  await page.waitForFunction(() => document.querySelector("#extras-saida")?.textContent !== "", null, { timeout: 20000 });
});
summary.avatar = await page.textContent("#extras-saida");

await step("rpc-logado", async () => {
  await page.evaluate(() => (document.querySelector("#extras-saida").textContent = ""));
  await page.click("#total");
  await page.waitForFunction(() => document.querySelector("#extras-saida")?.textContent !== "");
});
summary.total = await page.textContent("#extras-saida");

await step("sair", async () => {
  await page.click("#sair");
  await page.waitForFunction(() => document.querySelector("#conta-status")?.textContent === "saiu");
});

summary.pageErrors = errors;
writeFileSync(new URL("../out/auth-summary.json", import.meta.url), JSON.stringify(summary, null, 2));
console.log("\nResumo:", JSON.stringify({ userStatus: summary.userStatus, mensagem: summary.mensagem, realtimeEvents: summary.realtimeEvents, listaServidor: summary.listaServidor, listaCliente: summary.listaCliente, avatar: summary.avatar, total: summary.total, pageErrors: errors }, null, 2));
console.log("USER_ID_FOR_CHECK", summary.userId);
await browser.close();
