import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { transformAsync } from "@babel/core";
import mapaBabelPlugin from "../dist/index.js";

const ROOT = "/projeto";

async function transform(code, { file = "components/AddItem.tsx", layer = "browser", config, runtimeImport, awaitsOnly } = {}) {
  const ext = file.split(".").pop();
  const result = await transformAsync(code, {
    filename: `${ROOT}/${file}`,
    babelrc: false,
    configFile: false,
    sourceType: "unambiguous",
    parserOpts: { plugins: [...(ext.startsWith("ts") ? ["typescript"] : []), ...(ext === "ts" ? [] : ["jsx"])] },
    plugins: [[mapaBabelPlugin, { layer, root: ROOT, config, runtimeImport, awaitsOnly }]],
  });
  return result.code;
}

/** Minimal recorder with the same contract as the real ones (stack of frames, await save/restore). */
function fakeRuntime() {
  const calls = [];
  let current = null;
  const r = (thisArg, fn, args, meta) => {
    const frame = { meta, parent: current, args: [...args] };
    calls.push({ name: `${meta.klass}.${meta.id}`, parent: current ? `${current.meta.klass}.${current.meta.id}` : null, meta, args: [...args], thisArg });
    const saved = current;
    current = frame;
    try {
      return fn.apply(thisArg, args);
    } finally {
      current = saved;
    }
  };
  const box = (p) => p.then((v) => ({ v }), (e) => ({ e, failed: true }));
  return {
    calls,
    __mapa: {
      r,
      cur: () => current,
      bf: (x) => {
        current = null; // another task may run while we wait
        return box(Promise.resolve(x));
      },
      af: (frame, b) => {
        current = frame;
        if (b.failed) throw b.e;
        return b.v;
      },
      rs: (frame) => {
        current = frame;
      },
    },
  };
}

async function run(code, options) {
  const out = await transform(code, options);
  const runtime = fakeRuntime();
  const context = vm.createContext({ globalThis: undefined, console, setTimeout, Promise, result: undefined });
  context.globalThis = context;
  context.__mapa = runtime.__mapa;
  await vm.runInContext(`(async () => { ${out}\n })()`, context);
  return { out, calls: runtime.calls, context };
}

test("records function declarations, arrows, methods and keeps behaviour", async () => {
  const { calls, context } = await run(
    `
    function formatarPreco(valor, moeda = "BRL") { return moeda + " " + valor.toFixed(2); }
    const somar = (a, b) => a + b;
    class Carrinho {
      itens = [];
      adicionar(preco) { this.itens.push(preco); return this.total(); }
      total() { return this.itens.reduce((s, p) => somar(s, p), 0); }
      static criar() { return new this(); }
    }
    const c = Carrinho.criar();
    c.adicionar(2); c.adicionar(3);
    globalThis.result = [formatarPreco(9.9), c.total(), formatarPreco.length, formatarPreco.name, somar.name];
  `,
    { file: "lib/precos.js" },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), ["BRL 9.90", 5, 1, "formatarPreco", "somar"]);
  const names = calls.map((c) => c.name);
  assert.ok(names.includes("precos.formatarPreco"));
  assert.ok(names.includes("Carrinho.adicionar"));
  assert.ok(names.includes("Carrinho.criar"));
  const adicionar = calls.find((c) => c.name === "Carrinho.adicionar");
  assert.equal(adicionar.meta.path, "lib/precos.js");
  assert.equal(adicionar.meta.lineno, 6);
  assert.equal(adicionar.meta.static, false);
  assert.deepEqual([...adicionar.meta.params], ["preco"]);
  assert.equal(calls.find((c) => c.name === "Carrinho.criar").meta.static, true);
  const total = calls.find((c) => c.name === "Carrinho.total" && c.parent === "Carrinho.adicionar");
  assert.ok(total, "nested call has its parent");
  assert.ok(calls.some((c) => c.name === "precos.somar" && c.parent === "Carrinho.total"), "anonymous reduce callback is not recorded, its calls attach to total");
});

test("this, arguments, super and default values work as before", async () => {
  const { context, calls } = await run(
    `
    let defaults = 0;
    const d = () => ++defaults;
    function f(a = d()) { return [this && this.tag, arguments.length, a]; }
    class A { hello() { return "A"; } }
    class B extends A { hello() { return super.hello() + "B"; } }
    const obj = { tag: "obj", f, m() { return this.tag; } };
    globalThis.result = [obj.f(), new B().hello(), obj.m(), defaults];
  `,
    { file: "lib/x.js" },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), [["obj", 0, 1], "AB", "obj", 1]);
  assert.equal(calls.filter((c) => c.name === "x.d").length, 1, "default value evaluated once");
});

test("exceptions propagate unchanged", async () => {
  const { context } = await run(
    `
    function falhar() { throw new TypeError("proposital"); }
    try { falhar(); } catch (e) { globalThis.result = e.name + ":" + e.message; }
  `,
    { file: "lib/x.js" },
  );
  assert.equal(context.result, "TypeError:proposital");
});

test("browser: awaits keep the logical stack across interleaved tasks", async () => {
  const { calls, context } = await run(
    `
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    function formatarPreco(v) { return "R$ " + v; }
    async function buscar() { await esperar(5); return 9.9; }
    async function adicionarItem() {
      const preco = await buscar();
      return formatarPreco(preco);
    }
    async function outra() { await esperar(1); formatarPreco(1); }
    globalThis.result = await Promise.all([adicionarItem(), outra()]);
  `,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), ["R$ 9.9", null]);
  const fp = calls.filter((c) => c.name === "AddItem.formatarPreco").map((c) => c.parent).sort();
  assert.deepEqual(fp, ["AddItem.adicionarItem", "AddItem.outra"]);
  assert.equal(calls.find((c) => c.name === "AddItem.buscar").parent, "AddItem.adicionarItem");
});

test("browser: rejected awaits still restore the stack and throw into try/catch", async () => {
  const { calls, context } = await run(
    `
    function registrar(m) { return m; }
    async function f() {
      try { await Promise.reject(new Error("x")); } catch (e) { registrar(e.message); }
      for await (const v of [Promise.resolve(1)]) registrar(v);
      registrar("fim");
    }
    await f();
    globalThis.result = "ok";
  `,
  );
  assert.equal(context.result, "ok");
  assert.deepEqual(calls.filter((c) => c.name === "AddItem.registrar").map((c) => c.parent), ["AddItem.f", "AddItem.f", "AddItem.f"]);
});

test("server layer does not mark awaits (AsyncLocalStorage handles them)", async () => {
  const out = await transform("export async function f() { await g(); }", { file: "lib/x.ts", layer: "server" });
  assert.ok(!out.includes("__mapa.bf"));
  assert.ok(out.includes("__mapa.r"));
  const browser = await transform("export async function f() { await g(); }", { file: "lib/x.ts" });
  assert.ok(browser.includes("__mapa.bf"));
});

test("React: components, inline handlers and hook callbacks get names", async () => {
  const out = await transform(
    `"use client";
import { useState, useEffect, useCallback } from "react";
export default function AddItem() {
  const [n, setN] = useState(0);
  useEffect(() => { console.log(n); }, [n]);
  const salvar = useCallback(async () => { await fetch("/x"); }, []);
  return <button onClick={() => setN(n + 1)}>+</button>;
}
`,
    { runtimeImport: "/rt/browser.js" },
  );
  assert.ok(out.startsWith('"use client";\n\nimport "/rt/browser.js";') || out.startsWith('"use client";\nimport "/rt/browser.js";'), out.slice(0, 80));
  const registry = JSON.parse(JSON.stringify(eval(`(${out.match(/var __mapaFns = (\[[\s\S]*?\]);\n/)[1]})`)));
  const byName = Object.fromEntries(registry.map((f) => [f.id, f]));
  assert.deepEqual(byName.AddItem.labels, ["mapa.react-component"]);
  assert.deepEqual(byName["AddItem.useEffect@5"].labels, ["mapa.react-hook"]);
  assert.deepEqual(byName.salvar.labels, ["mapa.react-hook"]);
  assert.deepEqual(byName["AddItem.onClick@7"].labels, ["mapa.event-handler"]);
  assert.equal(byName["AddItem.onClick@7"].lineno, 7);
});

test("server actions: no this/arguments, parameters moved inside, directive first, label", async () => {
  const out = await transform(
    `"use server";
import { criar } from "@/lib/s";
export async function alterarItem(id: number, nome: string) {
  const s = await criar();
  return { ok: !!s };
}
export const apagar = async (id: number) => ({ id });
`,
    { file: "app/actions.ts", layer: "server" },
  );
  assert.ok(out.startsWith('"use server";'));
  assert.ok(!/\barguments\b/.test(out) && !/\bthis\b/.test(out), out);
  assert.match(out, /export async function alterarItem\(\.\.\.\$mapaArgs\)/);
  assert.match(out, /async \(id: number, nome: string\) =>/);
  assert.match(out, /export const apagar = async \(\.\.\.\$mapaArgs\) =>/);
  assert.match(out, /"mapa.server-action"/);
});

test("inline 'use server' function keeps its directive first", async () => {
  const out = await transform(
    `export default function Page() {
  async function enviar(formData) { "use server"; return formData; }
  return <form action={enviar} />;
}`,
    { file: "app/page.tsx", layer: "server" },
  );
  assert.match(out, /async function enviar\(\.\.\.\$mapaArgs\) \{\s*"use server";\s*return globalThis\.__mapa\.r\(undefined/);
});

test("TypeScript-only syntax (enum, generics, overloads) is kept for Next to compile", async () => {
  const out = await transform(
    `export enum Moeda { BRL = "BRL" }
export function f(a: string): void;
export function f(a: any) { return a; }
export const id = <T,>(x: T): T => x;
namespace N { export const y = 1; }
`,
    { file: "lib/precos.tsx" },
  );
  assert.match(out, /export enum Moeda/);
  assert.match(out, /export function f\(a: string\): void;/);
  assert.match(out, /namespace N/);
  assert.match(out, /<T,>\(x: T\): T => x/);
});

test("config: excluded files are untouched; excluded functions are skipped; labels applied", async () => {
  const config = { packages: [{ path: "lib", exclude: ["lib/gerado", "formatarData", "Api.log"], functions: [{ name: "entrar", label: "security.authentication" }] }] };
  assert.equal(await transform("export function a() {}", { file: "lib/gerado/x.ts", config }), "export function a() {}");
  assert.equal(await transform("export function a() {}", { file: "app/page.ts", config }), "export function a() {}", "not in a package");
  const out = await transform("export function formatarData() {}\nexport class Api { log() {} salvar() {} }\nexport function entrar() {}", { file: "lib/u.ts", config });
  assert.ok(!/"formatarData"/.test(out));
  assert.ok(!/id: "log"/.test(out) && /"salvar"/.test(out));
  assert.match(out, /"security.authentication"/);
  assert.match(out, /pkg: 0/);
});

test("node_modules and files outside the project are never instrumented", async () => {
  const code = "export function a() {}";
  assert.equal(await transform(code, { file: "node_modules/x/index.js" }), code);
  assert.equal(await transform(code, { file: "../fora/x.js" }), code);
});

test("CommonJS files get require() instead of import", async () => {
  const out = await transform("function a() {}\nmodule.exports = { a };", { file: "lib/c.cjs", runtimeImport: "/rt/server.js" });
  assert.match(out, /^require\("\/rt\/server.js"\);/);
});

test("browser: a continuation that ends does not leak its frame into later work", async () => {
  const { calls } = await run(
    `
    function render() { return "tela"; }
    async function adicionarItem() { await Promise.resolve(); render(); }
    await adicionarItem();
    await new Promise((r) => setTimeout(r, 1));
    render(); // e.g. a React re-render scheduled later: must have no parent
    function handler() {
      (async () => { if (true) return; await 0; })(); // finishes without suspending
      render(); // still inside handler
    }
    handler();
  `,
  );
  assert.deepEqual(calls.filter((c) => c.name === "AddItem.render").map((c) => c.parent), ["AddItem.adicionarItem", null, "AddItem.handler"]);
});

test("React components without parameters record their props as `props`", async () => {
  const out = await transform("export default function Lista() { return <ul />; }", { file: "components/Lista.tsx" });
  assert.match(out, /params: \["props"\]/);
});

test("awaitsOnly (supabase-js in node_modules): marks awaits, records no function", async () => {
  const code = "export async function fetchWithAuth(u) { const t = await getAccessToken(); return fetch(u, t); }";
  const out = await transform(code, { file: "node_modules/@supabase/supabase-js/dist/x.js", awaitsOnly: true, runtimeImport: "/rt/browser.js" });
  assert.match(out, /__mapa\.bf/);
  assert.ok(!out.includes("__mapa.r("));
  assert.ok(!out.includes("__mapaFns"));
  assert.match(out, /^import "\/rt\/browser.js";/);
});

test("labels from comments above the function (// @label, // @labels)", async () => {
  const out = await transform(
    `// @label security.authentication
export async function entrar() {}
/** @labels log audit */
const registrar = () => {};
class Api {
  // @label dao.materialize
  listar() {}
}`,
    { file: "lib/auth.ts" },
  );
  assert.match(out, /id: "entrar"[\s\S]*?labels: \["security.authentication"\]/);
  assert.match(out, /id: "registrar"[\s\S]*?labels: \["log", "audit"\]/);
  assert.match(out, /id: "listar"[\s\S]*?labels: \["dao.materialize"\]/);
});
