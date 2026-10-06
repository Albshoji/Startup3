import { createBrowserClient } from "@supabase/ssr";

export function criarClienteNavegador() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54399", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon-fake-key");
}
