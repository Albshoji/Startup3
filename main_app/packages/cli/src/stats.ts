import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { gunzipSync } from "node:zlib";
import { RECORDINGS_DIR } from "@mapa/collector";
import {
  CONFIG_FILE,
  ConfigMatcher,
  computeStats,
  DEFAULT_PACKAGES,
  EXCLUDE_SUGGESTION_THRESHOLD,
  parseConfig,
  type AppMap,
  type FunctionStats,
  type MapaConfig,
} from "@mapa/format";
import { findNextProject, MapaError } from "./project.js";
import { say } from "./output.js";

const LIMIT_DEFAULT = 10;

/**
 * `mapa stats [gravação] [--limit N] [--json] [--aplicar]`: the most called functions of a
 * recording and their estimated size, like `appmap stats`, and exclusions to add to
 * `.mapa/config.json` for very repetitive functions (AppMap's refining process).
 */
export async function stats(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const apply = args.includes("--aplicar");
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || LIMIT_DEFAULT : LIMIT_DEFAULT;
  const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit");

  const project = findNextProject(process.cwd());
  const file = resolveRecording(project.root, target);
  const raw = readFileSync(file);
  const appmap = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as AppMap;
  const result = computeStats(appmap);

  if (json) {
    console.log(JSON.stringify({ ...result, functions: result.functions.slice(0, limit) }, null, 2));
    return 0;
  }

  say(`Gravação: ${relative(project.root, dirname(file))}`);
  const layers = Object.entries(result.byLayer)
    .map(([layer, n]) => `${LAYER_NAMES[layer] ?? layer}: ${n}`)
    .join(" · ");
  console.log(`  ${result.events} eventos, ${size(result.bytes)} sem compressão (${size(raw.length)} no arquivo)${layers ? ` · chamadas por camada: ${layers}` : ""}\n`);
  console.log("Funções mais chamadas:");
  result.functions.slice(0, limit).forEach((f, i) => {
    const omitted = f.omitted ? ` + ${f.omitted} omitidas pelo teto de chamadas` : "";
    console.log(`  ${i + 1}. ${f.function}  (${f.location})`);
    console.log(`        chamadas: ${f.count} ${f.count === 1 ? "gravada" : "gravadas"}${omitted}`);
    console.log(`        tamanho estimado: ${size(f.size)}`);
  });
  if (result.functions.length === 0) console.log("  (nenhuma função gravada)");

  if (result.suggestions.length === 0) {
    console.log(`\nNenhuma função passou de ${EXCLUDE_SUGGESTION_THRESHOLD} chamadas: nada a sugerir.`);
    return 0;
  }
  console.log(`\nSugestão: estas funções passaram de ${EXCLUDE_SUGGESTION_THRESHOLD} chamadas. Excluí-las deixa as próximas gravações menores e mais fáceis de ler:`);
  for (const f of result.suggestions) console.log(`  - ${f.exclude}  (${f.location}, ${f.count + f.omitted} chamadas)`);

  let accepted = apply;
  if (!accepted && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nAdicionar essas exclusões ao ${CONFIG_FILE}? (s/N) `);
    rl.close();
    accepted = /^s(im)?$/i.test(answer.trim());
  }
  if (!accepted) {
    console.log(`\nPara adicionar ao ${CONFIG_FILE}: npx mapa stats --aplicar`);
    return 0;
  }
  const added = await addExclusions(project.root, result.suggestions);
  say(added.length ? `Adicionado ao ${CONFIG_FILE}: ${added.join(", ")}. Vale ao reiniciar o \`npx mapa dev\`.` : "Essas exclusões já estavam no arquivo.");
  return 0;
}

const LAYER_NAMES: Record<string, string> = { browser: "navegador", "next-server": "servidor do Next", supabase: "Supabase" };

function size(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

/** A recording folder or file; by default the most recent recording of the project. */
function resolveRecording(root: string, target: string | undefined): string {
  const candidates = (path: string) => [join(path, "recording.appmap.json.gz"), join(path, "recording.appmap.json"), path];
  if (target) {
    for (const path of [target, join(root, target), join(root, RECORDINGS_DIR, target)]) {
      const found = candidates(path).find((p) => existsSync(p) && statSync(p).isFile());
      if (found) return found;
    }
    throw new MapaError(`Não encontrei a gravação "${target}".`);
  }
  const dir = join(root, RECORDINGS_DIR);
  const folders = existsSync(dir) ? readdirSync(dir).filter((name) => existsSync(join(dir, name, "recording.appmap.json.gz"))).sort() : [];
  const latest = folders.at(-1);
  if (!latest) throw new MapaError("Ainda não há gravações neste projeto. Grave com o botão do Mapa ou com `npx mapa record start`.");
  return join(dir, latest, "recording.appmap.json.gz");
}

/** Adds `exclude` entries to the package of each function (creating the config when needed). */
export async function addExclusions(root: string, suggestions: FunctionStats[]): Promise<string[]> {
  const file = join(root, CONFIG_FILE);
  let config: MapaConfig = {};
  if (existsSync(file)) config = parseConfig(JSON.parse(readFileSync(file, "utf8"))).config;
  if (!config.packages?.length) config.packages = DEFAULT_PACKAGES.map((p) => ({ ...p, exclude: [...(p.exclude ?? [])] }));
  const matcher = new ConfigMatcher(config);
  const added: string[] = [];
  for (const s of suggestions) {
    if (!s.exclude || !s.path) continue;
    const pkg = matcher.matchFile(s.path);
    const target = config.packages[pkg?.index ?? 0]!;
    target.exclude ??= [];
    if (!target.exclude.includes(s.exclude)) {
      target.exclude.push(s.exclude);
      added.push(s.exclude);
    }
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return added;
}
