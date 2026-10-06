import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Client with the SECRET key: bypasses RLS. Only for server code (route handlers and server
 * actions) that has already checked who is asking (CLI token or session). Never import it in a
 * client component.
 */
export function supabaseAdmin() {
  return createClient(env.supabaseUrl(), env.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const RECORDINGS_BUCKET = "recordings";
