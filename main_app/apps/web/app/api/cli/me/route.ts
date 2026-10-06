import { authenticateCli, cliError } from "@/lib/cli-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Who this computer is logged in as (`mapa login` status). */
export async function GET(request: Request) {
  const caller = await authenticateCli(request);
  if (!caller) return cliError(401, "unauthorized", "Este computador não está conectado. Rode `npx mapa login`.");
  const { data } = await supabaseAdmin().auth.admin.getUserById(caller.userId);
  return Response.json({ email: data.user?.email ?? null });
}
