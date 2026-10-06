import { DEVICE_CODE_TTL_SECONDS, newDeviceCode, newUserCode, POLL_INTERVAL_SECONDS, sha256, siteOrigin } from "@/lib/cli-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Step 1 of `mapa login`: a device code for the CLI and a short code for the person. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { client_name?: unknown };
  const clientName = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : null;
  const deviceCode = newDeviceCode();
  const admin = supabaseAdmin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = newUserCode();
    const { error } = await admin.from("cli_device_codes").insert({
      device_code_hash: sha256(deviceCode),
      user_code: userCode,
      client_name: clientName,
      expires_at: new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000).toISOString(),
    });
    if (error?.code === "23505") continue; // short code already in use: draw another
    if (error) return Response.json({ error: "server_error", message: "Não consegui iniciar o login. Tente de novo." }, { status: 500 });
    const origin = siteOrigin(request);
    return Response.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${origin}/dispositivo`,
      verification_uri_complete: `${origin}/dispositivo?codigo=${userCode}`,
      expires_in: DEVICE_CODE_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
    });
  }
  return Response.json({ error: "server_error", message: "Não consegui iniciar o login. Tente de novo." }, { status: 500 });
}
