import { criarClienteServidor } from "@/lib/supabase-server";
import { formatarPreco } from "@/lib/precos";
import AddItem from "@/components/AddItem";
import LoopButton from "@/components/LoopButton";
import AsyncChain from "@/components/AsyncChain";
import ErrorButton from "@/components/ErrorButton";
import ListaGrande from "@/components/ListaGrande";
import ListaCliente from "@/components/ListaCliente";

async function carregarItens() {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("items").select("id,nome,preco").order("id");
  return data ?? [];
}

export default async function Home() {
  const itens = await carregarItens();
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1 id="titulo">Itens</h1>
      <ul id="lista-servidor">
        {itens.map((i: { id: number; nome: string; preco: number }) => (
          <li key={i.id}>
            {i.nome} — {formatarPreco(i.preco)}
          </li>
        ))}
      </ul>
      <AddItem />
      <LoopButton />
      <AsyncChain />
      <ErrorButton />
      <ListaGrande />
      <ListaCliente />
    </main>
  );
}
