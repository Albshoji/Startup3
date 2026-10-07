#!/usr/bin/env node
// Local processor: asks the site to run due processing jobs every 15 s (the logs phase waits minutes).
// Usage: node apps/web/scripts/worker.mjs   (site running at http://localhost:3300)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "utf8");
const secret = /^MAPA_WORKER_SECRET=(.*)$/m.exec(env)?.[1]?.trim();
const site = process.env.MAPA_SITE_URL ?? "http://localhost:3300";
if (!secret) {
  console.error("Falta MAPA_WORKER_SECRET em apps/web/.env.local");
  process.exit(2);
}
for (;;) {
  try {
    const res = await fetch(`${site}/api/internal/process`, { method: "POST", headers: { "x-mapa-worker-secret": secret } });
    const body = await res.json();
    if (body.processed) console.log(`${new Date().toLocaleTimeString("pt-BR")} processados: ${body.processed}`);
  } catch {
    // site not running yet
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
