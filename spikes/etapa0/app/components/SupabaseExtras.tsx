"use client";

import { useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase-browser";

export default function SupabaseExtras() {
  const [saida, setSaida] = useState("");
  const [eventos, setEventos] = useState(0);

  useEffect(() => {
    const supabase = criarClienteNavegador();
    const canal = supabase
      .channel("itens-ao-vivo")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, () => setEventos((n) => n + 1))
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, []);

  async function chamarBoasVindas() {
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.functions.invoke("send-welcome", { body: { nome: "Maria" } });
    setSaida(error ? "erro: " + error.message : data.mensagem);
  }

  async function enviarAvatar() {
    const supabase = criarClienteNavegador();
    const arquivo = new Blob(["avatar de teste"], { type: "text/plain" });
    const { data: sessao } = await supabase.auth.getUser();
    const pasta = sessao.user?.id ?? "anonimo";
    const { error } = await supabase.storage.from("avatars").upload(`${pasta}/avatar-${Date.now()}.txt`, arquivo);
    setSaida(error ? "avatar recusado: " + error.message : "avatar enviado");
  }

  async function somarTotal() {
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.rpc("calcular_total");
    setSaida(error ? "erro: " + error.message : `total: ${data}`);
  }

  return (
    <section>
      <button id="boas-vindas" onClick={chamarBoasVindas}>Edge Function</button>
      <button id="avatar" onClick={enviarAvatar}>Enviar avatar</button>
      <button id="total" onClick={somarTotal}>calcular_total</button>
      <span id="extras-saida">{saida}</span> <span id="realtime-eventos">{eventos}</span>
    </section>
  );
}
