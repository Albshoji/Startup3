import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { api, ApiError, deleteCredentials, readCredentials, saveCredentials, siteUrl } from "./account.js";
import { MapaError } from "./project.js";
import { say } from "./output.js";

interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** `mapa login`: connects this computer to a Mapa account (device code flow, like `gh auth login`). */
export async function login(): Promise<number> {
  const existing = readCredentials();
  if (existing) {
    try {
      const me = await api<{ email: string | null }>(siteUrl(existing), "/api/cli/me", { token: existing.token });
      say(`Este computador já está conectado à conta ${me.email ?? "(sem e-mail)"}. Para trocar de conta: npx mapa logout`);
      return 0;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
      deleteCredentials(); // token revoked on the site: start again
    }
  }

  const site = siteUrl();
  const start = await api<DeviceStart>(site, "/api/cli/device", { body: { client_name: hostname() } });
  say("Para conectar este computador à sua conta do Mapa, abra no navegador:");
  console.log(`\n    ${start.verification_uri_complete}\n`);
  say(`e confira se o código é este: ${start.user_code}`);
  openBrowser(start.verification_uri_complete);
  say("Esperando você autorizar no site…");

  const deadline = Date.now() + start.expires_in * 1000;
  let interval = Math.max(1, start.interval) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    try {
      const result = await api<{ token: string; email: string | null }>(site, "/api/cli/token", { body: { device_code: start.device_code } });
      saveCredentials({ site, token: result.token, email: result.email, created_at: new Date().toISOString() });
      say(`Pronto: este computador está conectado à conta ${result.email ?? ""}.`);
      return 0;
    } catch (error) {
      if (error instanceof ApiError && error.code === "authorization_pending") continue;
      if (error instanceof ApiError && error.code === "slow_down") {
        interval += 2000;
        continue;
      }
      throw error;
    }
  }
  throw new MapaError("O código expirou antes da autorização. Rode `npx mapa login` de novo.");
}

/** `mapa logout`: revokes this computer's token on the site and forgets it here. */
export async function logout(): Promise<number> {
  const credentials = readCredentials();
  if (!credentials) {
    say("Este computador não está conectado a nenhuma conta.");
    return 0;
  }
  try {
    await api(siteUrl(credentials), "/api/cli/logout", { method: "POST", body: {}, token: credentials.token });
  } catch {
    // Offline or already revoked: forgetting the token here is what matters.
  }
  deleteCredentials();
  say("Desconectado. As próximas gravações ficam só neste computador.");
  return 0;
}

function openBrowser(url: string) {
  if (process.env.MAPA_NO_BROWSER || !process.stdout.isTTY) return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // no browser available: the person opens the link by hand
  }
}
