"use client";

import { useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase-browser";

export default function Conta() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [status, setStatus] = useState("");

  async function cadastrar(evento: React.FormEvent) {
    evento.preventDefault();
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.auth.signUp({ email, password: senha });
    setStatus(error ? "erro: " + error.message : `cadastrado: ${data.user?.id}`);
  }

  async function entrar() {
    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setStatus(error ? "erro: " + error.message : `logado: ${data.user?.id}`);
  }

  async function sair() {
    const supabase = criarClienteNavegador();
    await supabase.auth.signOut();
    setStatus("saiu");
  }

  return (
    <form onSubmit={cadastrar}>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input id="senha-conta" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
      <button id="cadastrar" type="submit">Cadastrar</button>
      <button id="entrar" type="button" onClick={entrar}>Entrar</button>
      <button id="sair" type="button" onClick={sair}>Sair</button>
      <span id="conta-status">{status}</span>
    </form>
  );
}
