"use client";

import { useState } from "react";

async function passo1(n: number) {
  const a = await passo2(n + 1);
  return a * 2;
}

async function passo2(n: number) {
  await new Promise((r) => setTimeout(r, 30));
  const resp = await fetch("/api/hello?n=" + n);
  const json = await resp.json();
  return passo3(json.valor);
}

const passo3 = async (v: number) => {
  await null;
  return v + 1;
};

export default function AsyncChain() {
  const [r, setR] = useState<number | null>(null);
  return (
    <section>
      <button id="async" onClick={async () => setR(await passo1(1))}>
        Await encadeado
      </button>
      <span id="async-resultado">{r}</span>
    </section>
  );
}
