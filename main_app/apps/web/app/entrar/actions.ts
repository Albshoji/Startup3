"use server";

import { redirect } from "next/navigation";
import { supabaseForUser } from "@/lib/supabase/server";

/** Only local paths, so the form cannot send the person to another site. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/gravacoes";
}

function back(message: string, next: string): never {
  redirect(`/entrar?erro=${encodeURIComponent(message)}&depois=${encodeURIComponent(next)}`);
}

export async function entrar(form: FormData) {
  const next = safeNext(form.get("depois"));
  const supabase = await supabaseForUser();
  const { error } = await supabase.auth.signInWithPassword({ email: String(form.get("email") ?? ""), password: String(form.get("senha") ?? "") });
  if (error) back("E-mail ou senha incorretos.", next);
  redirect(next);
}

export async function criarConta(form: FormData) {
  const next = safeNext(form.get("depois"));
  const supabase = await supabaseForUser();
  const { data, error } = await supabase.auth.signUp({ email: String(form.get("email") ?? ""), password: String(form.get("senha") ?? "") });
  if (error) back(error.message.includes("Password") ? "A senha precisa ter pelo menos 6 caracteres." : `Não foi possível criar a conta: ${error.message}`, next);
  if (!data.session) back("Conta criada. Confirme o e-mail que enviamos e depois entre.", next);
  redirect(next);
}
