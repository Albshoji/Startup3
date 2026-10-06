import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";

export default async function Home() {
  if (await currentUser()) redirect("/gravacoes");
  return (
    <div className="card">
      <h1>Veja como o seu app funciona por dentro</h1>
      <p>
        O Mapa grava o que acontece no seu app Next.js + Supabase enquanto você usa: cada clique, cada função e cada pedido ao
        Supabase. Depois mostra tudo em diagramas e em português simples.
      </p>
      <div className="row">
        <Link className="button" href="/entrar">
          Criar conta ou entrar
        </Link>
      </div>
    </div>
  );
}
