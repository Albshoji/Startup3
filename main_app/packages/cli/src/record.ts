import type { RecordingStatus, SavedRecording } from "@mapa/collector";
import { readCollectorState } from "@mapa/collector";
import { findNextProject, MapaError } from "./project.js";
import { say } from "./output.js";

/** `mapa record start [nome] | stop | status`, talking to the collector of `mapa dev`. */
export async function record(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  const project = findNextProject(process.cwd());
  const state = await readCollectorState(project.root);
  if (!state) throw new MapaError("O Mapa não está rodando neste projeto. Rode `npx mapa dev` primeiro.");

  const endpoint = `${state.url}/record`;
  const request = async (method: string, body?: unknown) => {
    try {
      return await fetch(endpoint, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new MapaError("Não consegui falar com o Mapa. O `npx mapa dev` ainda está aberto?");
    }
  };

  switch (action) {
    case "start": {
      const name = rest.join(" ").trim() || undefined;
      const res = await request("POST", name ? { name } : undefined);
      if (res.status === 409) {
        say("Já existe uma gravação em andamento. Para parar: npx mapa record stop");
        return 1;
      }
      const status = (await res.json()) as RecordingStatus;
      say(`Gravando. Use o app normalmente; a gravação para sozinha em ${status.limits.maxSeconds} segundos ou com: npx mapa record stop`);
      return 0;
    }
    case "stop": {
      const res = await request("DELETE");
      if (res.status === 404) {
        say("Nenhuma gravação em andamento.");
        return 1;
      }
      const saved = (await res.json()) as SavedRecording;
      say(`Gravação salva: ${saved.directory}`);
      say(`${saved.event_count} eventos · ${formatBytes(saved.gzip_bytes)} comprimido`);
      return 0;
    }
    case "status": {
      const status = (await (await request("GET")).json()) as RecordingStatus;
      if (!status.enabled) say("Sem gravação em andamento.");
      else say(`Gravando há ${status.elapsed_seconds}s · faltam ${status.remaining_seconds}s · ${status.event_count} eventos`);
      return 0;
    }
    default:
      throw new MapaError("Use: npx mapa record start [nome] | stop | status");
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
