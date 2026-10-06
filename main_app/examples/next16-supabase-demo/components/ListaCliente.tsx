"use client";

import { useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase-browser";

type Item = { id: number; nome: string };

export default function ListaCliente() {
  const [itens, setItens] = useState<Item[]>([]);
  const [aoVivo, setAoVivo] = useState(0);

  useEffect(() => {
    const supabase = criarClienteNavegador();
    supabase
      .from("items")
      .select("id,nome")
      .then(({ data }) => setItens(data ?? []));
    const canal = supabase
      .channel("itens-ao-vivo")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, () => setAoVivo((n) => n + 1))
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, []);

  return (
    <section>
      <h2>Lista no navegador</h2>
      <p id="lista-cliente">{itens.length} itens (navegador)</p>
      <p id="realtime-eventos">{aoVivo} mudanças ao vivo</p>
    </section>
  );
}
