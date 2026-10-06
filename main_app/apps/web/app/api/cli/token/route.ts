import { cliError, newCliToken, sha256 } from "@/lib/cli-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Step 3 of `mapa login`: the CLI polls until the person approved the code on the site. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { device_code?: unknown };
  if (typeof body.device_code !== "string") return cliError(400, "invalid_request", "Pedido inválido.");
  const admin = supabaseAdmin();
  const { data: code } = await admin.from("cli_device_codes").select("*").eq("device_code_hash", sha256(body.device_code)).maybeSingle();
  if (!code || code.consumed_at) return cliError(400, "invalid_grant", "Este código de login não vale mais. Rode `npx mapa login` de novo.");
  if (new Date(code.expires_at).getTime() < Date.now()) return cliError(400, "expired_token", "O código expirou. Rode `npx mapa login` de novo.");
  if (!code.approved_at || !code.user_id) return cliError(400, "authorization_pending", "Esperando a autorização no site.");

  // Consume the code first, so a second poll can never get a second token.
  const { data: consumed } = await admin
    .from("cli_device_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("device_code_hash", code.device_code_hash)
    .is("consumed_at", null)
    .select("device_code_hash");
  if (!consumed?.length) return cliError(400, "invalid_grant", "Este código de login não vale mais. Rode `npx mapa login` de novo.");

  const token = newCliToken();
  const { error } = await admin.from("cli_tokens").insert({ user_id: code.user_id, token_hash: sha256(token), name: code.client_name });
  if (error) return cliError(500, "server_error", "Não consegui concluir o login. Tente de novo.");
  const { data: user } = await admin.auth.admin.getUserById(code.user_id);
  return Response.json({ token, email: user.user?.email ?? null });
}
