// Files of a recording in the private bucket: <owner id>/<recording id>/<file> (CLAUDE.md §8 and §9.4).
export const RECORDING_FILES = {
  "recording.appmap.json.gz": "application/gzip",
  "interactions.json": "application/json",
} as const;
export type RecordingFile = keyof typeof RECORDING_FILES;

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const STATUS_LABELS: Record<string, string> = {
  enviando: "Enviando",
  recebida: "Recebida",
  processando: "Processando",
  pronta: "Pronta (app)",
  pronta_com_registros: "Pronta (com registros do Supabase)",
  erro: "Erro",
};

export const STOP_LABELS: Record<string, string> = {
  user: "parada por você",
  "time-limit": "parou no tempo máximo",
  "event-limit": "parou no máximo de eventos",
  "size-limit": "parou no tamanho máximo",
  shutdown: "o Mapa foi fechado",
};

/** Keeps only non-sensitive fields of the AppMap metadata sent by the CLI. */
export function summarizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const m = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const text = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);
  if (text(m.app)) out.app = text(m.app);
  if (Array.isArray(m.frameworks)) {
    out.frameworks = m.frameworks
      .slice(0, 10)
      .filter((f): f is { name: unknown; version: unknown } => !!f && typeof f === "object")
      .map((f) => ({ name: text(f.name, 60), version: text(f.version, 30) }));
  }
  const language = m.language as Record<string, unknown> | undefined;
  if (language && typeof language === "object") out.language = { name: text(language.name, 30), version: text(language.version, 30) };
  const git = m.git as Record<string, unknown> | undefined;
  if (git && typeof git === "object") out.git = { branch: text(git.branch, 100), commit: text(git.commit, 64) };
  const mapa = m.mapa as Record<string, unknown> | undefined;
  if (mapa && typeof mapa === "object" && typeof mapa.incomplete_calls === "number") out.incomplete_calls = mapa.incomplete_calls;
  return out;
}
