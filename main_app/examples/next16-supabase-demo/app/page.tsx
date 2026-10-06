import { criarClienteServidor } from "@/lib/supabase-server";
import { formatarPreco } from "@/lib/precos";
import Conta from "@/components/Conta";
import AddItem from "@/components/AddItem";
import AsyncChain from "@/components/AsyncChain";
import ListaCliente from "@/components/ListaCliente";
import SupabaseExtras from "@/components/SupabaseExtras";
import ErrorButton from "@/components/ErrorButton";
import LoopButton from "@/components/LoopButton";

async function carregarItens() {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("items").select("id, nome, preco").order("id");
  return { itens: data ?? [], erro: error?.message };
}

export default async function Home() {
  const { itens, erro } = await carregarItens();
  return (
    <main>
      <h1>Itens</h1>
      {erro && <p id="erro-lista">Erro: {erro}</p>}
      <p id="quantidade">{itens.length} itens visíveis</p>
      <ul id="lista-servidor">
        {itens.map((item) => (
          <li key={item.id}>
            {item.nome}: {formatarPreco(item.preco)}
          </li>
        ))}
      </ul>
      <Conta />
      <AddItem />
      <ListaCliente />
      <SupabaseExtras />
      <AsyncChain />
      <ErrorButton />
      <LoopButton />
    </main>
  );
}
