#!/usr/bin/env node
// Applies supabase/migrations/*.sql to the database of the MAPA SITE, in order, once each.
// Usage: node supabase/apply-migrations.mjs   (reads SUPABASE_DB_URL from apps/web/.env.local)
// Never point it at a user's project: user projects are read-only for Mapa (CLAUDE.md §14).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, "..", "apps", "web", ".env.local");
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const url = process.env.SUPABASE_DB_URL ?? env.SUPABASE_DB_URL;
if (!url) {
  console.error("Falta SUPABASE_DB_URL em apps/web/.env.local");
  process.exit(2);
}

// Read the parts by hand: a password with `#`, `@` or `/` (common in generated passwords) breaks
// URL parsing, so it is taken as everything between the user and the last `@`.
const parts = /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]*)/.exec(url);
if (!parts) {
  console.error("SUPABASE_DB_URL não está no formato postgresql://usuario:senha@servidor:porta/banco");
  process.exit(2);
}
const [, user, password, host, port, database] = parts;
const sql = postgres({ host, port: Number(port ?? 5432), user, password, database: database || "postgres", ssl: "require", max: 1, onnotice: () => {} });
try {
  await sql`create schema if not exists mapa_internal`;
  await sql`create table if not exists mapa_internal.migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from mapa_internal.migrations`).map((r) => r.name));
  const files = readdirSync(join(here, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`já aplicada: ${file}`);
      continue;
    }
    const text = readFileSync(join(here, "migrations", file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into mapa_internal.migrations (name) values (${file})`;
    });
    console.log(`aplicada: ${file}`);
  }
} finally {
  await sql.end();
}
