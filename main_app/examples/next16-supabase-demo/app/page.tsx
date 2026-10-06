import { criarClienteServidor } from "@/lib/supabase-server";
import AddItem from "@/components/AddItem";
import AsyncChain from "@/components/AsyncChain";

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
      {erro && <p id="erro">Erro: {erro}</p>}
      <p id="quantidade">{itens.length} itens visíveis</p>
      <ul>
        {itens.map((item) => (
          <li key={item.id}>
            {item.nome}: R$ {item.preco}
          </li>
        ))}
      </ul>
      <AddItem />
      <AsyncChain />
    </main>
  );
}
