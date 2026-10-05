import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function criarClienteServidor() {
  const cookieStore = await cookies();
  return createServerClient("http://localhost:54399", "anon-fake-key", {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {},
    },
  });
}
