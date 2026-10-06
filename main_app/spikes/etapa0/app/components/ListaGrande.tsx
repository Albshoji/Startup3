"use client";

import { useState } from "react";
import { formatarPreco } from "@/lib/precos";

type Produto = { id: number; nome: string; preco: number };

const produtos: Produto[] = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  nome: `Produto ${i + 1}`,
  preco: (i + 1) * 1.5,
}));

function filtrar(lista: Produto[], termo: string) {
  return lista.filter((p) => p.nome.toLowerCase().includes(termo.toLowerCase()));
}

function LinhaProduto({ produto }: { produto: Produto }) {
  return (
    <li>
      {produto.nome}: {formatarPreco(produto.preco)}
    </li>
  );
}

export default function ListaGrande() {
  const [termo, setTermo] = useState("");
  const visiveis = filtrar(produtos, termo);
  return (
    <section>
      <input id="busca" placeholder="buscar" value={termo} onChange={(e) => setTermo(e.target.value)} />
      <span id="qtd">{visiveis.length}</span>
      <ul style={{ maxHeight: 120, overflow: "auto" }}>
        {visiveis.map((p) => (
          <LinhaProduto key={p.id} produto={p} />
        ))}
      </ul>
    </section>
  );
}
