"use server";

import { criarClienteServidor } from "@/lib/supabase-server";

export async function alterarItem(id: number, nome: string) {
  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("items").update({ nome }).eq("id", id);
  return { ok: !error };
}
