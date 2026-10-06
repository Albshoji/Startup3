"use client";

import { useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase-browser";
import { formatarPreco, Carrinho } from "@/lib/precos";
import { alterarItem } from "@/app/actions";

const carrinho = new Carrinho();

export default function AddItem() {
  const [nome, setNome] = useState("Pão");
  const [mensagem, setMensagem] = useState("");

  async function adicionarItem() {
    const preco = 9.9;
    const precoFormatado = formatarPreco(preco);
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.from("items").insert({ nome, preco }).select();
    if (error) {
      setMensagem(`Não foi possível adicionar ${nome} (${precoFormatado}): ${error.message}`);
      return;
    }
    const total = carrinho.adicionar(preco);
    setMensagem(`Adicionado ${data?.[0]?.nome} por ${precoFormatado} (total ${formatarPreco(total)})`);
  }

  return (
    <section>
      <h2>Adicionar item</h2>
      <input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      <input id="senha" type="password" defaultValue="segredo123" />
      <button id="adicionar" onClick={() => adicionarItem()}>
        Adicionar item
      </button>
      <button
        id="alterar"
        onClick={async () => {
          const resultado = await alterarItem(1, nome);
          setMensagem(resultado.ok ? "Alterado" : `Falhou: ${resultado.erro}`);
        }}
      >
        Alterar item 1 (server action)
      </button>
      <p id="mensagem">{mensagem}</p>
    </section>
  );
}
