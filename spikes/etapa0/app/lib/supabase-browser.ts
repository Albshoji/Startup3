import { createBrowserClient } from "@supabase/ssr";

export function criarClienteNavegador() {
  return createBrowserClient("http://localhost:54399", "anon-fake-key");
}
