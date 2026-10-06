"use server";

import { redirect } from "next/navigation";
import { normalizeUserCode } from "@/lib/cli-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

/** Step 2 of `mapa login`: the logged-in person approves the code shown in their terminal. */
export async function autorizar(form: FormData) {
  const code = normalizeUserCode(String(form.get("codigo") ?? ""));
  const user = await currentUser();
  if (!user) redirect(`/entrar?depois=${encodeURIComponent(`/dispositivo?codigo=${code}`)}`);
  const { data } = await supabaseAdmin()
    .from("cli_device_codes")
    .update({ user_id: user.id, approved_at: new Date().toISOString() })
    .eq("user_code", code)
    .is("approved_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_code");
  if (!data?.length) redirect(`/dispositivo?codigo=${encodeURIComponent(code)}&erro=1`);
  redirect("/dispositivo?ok=1");
}
