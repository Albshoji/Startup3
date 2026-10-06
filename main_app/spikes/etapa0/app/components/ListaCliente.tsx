"use client";

import { useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase-browser";

export default function ListaCliente() {
  const [itens, setItens] = useState<{ id: number; nome: string }[]>([]);
  useEffect(() => {
    const supabase = criarClienteNavegador();
    supabase
      .from("items")
      .select("id,nome")
      .then(({ data }) => setItens(data ?? []));
  }, []);
  return <p id="lista-cliente">{itens.length} itens (cliente)</p>;
}
