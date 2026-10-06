"use client";

import { useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase-browser";

export default function SupabaseExtras() {
  const [saida, setSaida] = useState("");

  async function chamarBoasVindas() {
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.functions.invoke("send-welcome", { body: { nome: "Maria" } });
    setSaida(error ? `erro: ${error.message}` : data.mensagem);
  }

  async function enviarAvatar() {
    const supabase = criarClienteNavegador();
    const arquivo = new Blob(["avatar de teste"], { type: "text/plain" });
    const { data: sessao } = await supabase.auth.getUser();
    const pasta = sessao.user?.id ?? "anonimo";
    const { error } = await supabase.storage.from("avatars").upload(`${pasta}/avatar-${Date.now()}.txt`, arquivo);
    setSaida(error ? `avatar recusado: ${error.message}` : "avatar enviado");
  }

  async function somarTotal() {
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.rpc("calcular_total");
    setSaida(error ? `erro: ${error.message}` : `total: ${data}`);
  }

  async function totalPeloServidor() {
    const resposta = await fetch("/api/total?moeda=BRL");
    const corpo = await resposta.json();
    setSaida(`total pelo servidor: ${corpo.total}`);
  }

  return (
    <section>
      <h2>Supabase</h2>
      <button id="boas-vindas" onClick={chamarBoasVindas}>
        Edge Function
      </button>
      <button id="avatar" onClick={enviarAvatar}>
        Enviar avatar
      </button>
      <button id="total" onClick={somarTotal}>
        calcular_total
      </button>
      <button id="total-servidor" onClick={totalPeloServidor}>
        Total pelo servidor
      </button>
      <p id="extras-saida">{saida}</p>
    </section>
  );
}
