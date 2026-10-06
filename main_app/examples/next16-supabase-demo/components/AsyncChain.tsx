"use client";

import { useState } from "react";

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function buscarPedido(id: number) {
  await esperar(30 + id * 10);
  return { id, itens: [9.9, 5] };
}

async function calcularFrete(total: number) {
  await esperar(20);
  return total > 10 ? 0 : 7;
}

function somarItens(itens: number[]) {
  return itens.reduce((soma, valor) => soma + valor, 0);
}

async function processarPedido(id: number) {
  const pedido = await buscarPedido(id);
  const total = somarItens(pedido.itens);
  const frete = await calcularFrete(total);
  return `Pedido ${id}: total ${total.toFixed(2)} + frete ${frete}`;
}

export default function AsyncChain() {
  const [resultado, setResultado] = useState("");

  async function processarDois() {
    // Two chains at the same time: their awaits interleave in the browser.
    const textos = await Promise.all([processarPedido(1), processarPedido(2)]);
    setResultado(textos.join(" | "));
  }

  return (
    <section>
      <h2>Await encadeado</h2>
      <button id="async" onClick={processarDois}>
        Processar dois pedidos
      </button>
      <p id="async-resultado">{resultado}</p>
    </section>
  );
}
