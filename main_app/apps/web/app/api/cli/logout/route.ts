import { authenticateCli, cliError } from "@/lib/cli-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** `mapa logout`: revokes this computer's token. */
export async function POST(request: Request) {
  const caller = await authenticateCli(request);
  if (!caller) return cliError(401, "unauthorized", "Este computador já não estava conectado.");
  await supabaseAdmin().from("cli_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", caller.tokenId);
  return Response.json({ ok: true });
}
