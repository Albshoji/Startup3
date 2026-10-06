import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/** Supabase client acting as the logged-in person (their session cookie): RLS applies. */
export async function supabaseForUser() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** The logged-in person, or null. */
export async function currentUser() {
  const supabase = await supabaseForUser();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
