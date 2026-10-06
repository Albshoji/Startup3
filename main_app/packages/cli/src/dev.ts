import { spawn } from "node:child_process";
import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE, parseConfig, type MapaConfig } from "@mapa/format";
import { readCollectorState, removeCollectorState, startCollector, writeCollectorState } from "@mapa/collector";
import { buildMetadata } from "./metadata.js";
import {
  detectBundler,
  findNextProject,
  MapaError,
  missingNodeRequirement,
  nodeMajor,
  SUPPORTED_NEXT_MAJORS,
  SUPPORTED_NODE_MAJORS,
} from "./project.js";
import { say, warn } from "./output.js";
import { readCredentials } from "./account.js";
import { uploadConsented, uploadRecording } from "./upload.js";

/** `mapa dev [next dev args]`: starts the collector and `next dev` with MAPA=1. */
export async function dev(args: string[]): Promise<number> {
  const project = findNextProject(process.cwd());
  const bundler = detectBundler(project.nextMajor, args);

  const minimumNode = missingNodeRequirement();
  if (minimumNode) {
    throw new MapaError(`O Mapa precisa do Node ${minimumNode} ou mais novo (você está usando o ${process.version}). Atualize o Node e tente de novo.`);
  }
  if (!SUPPORTED_NODE_MAJORS.includes(nodeMajor())) {
    warn(`Você está usando o Node ${process.version}. O Mapa foi testado no Node ${SUPPORTED_NODE_MAJORS.join(" e ")}; pode funcionar, mas sem garantia.`);
  }
  if (!SUPPORTED_NEXT_MAJORS.includes(project.nextMajor)) {
    warn(`Seu app usa o Next ${project.nextVersion}. O Mapa suporta o Next ${SUPPORTED_NEXT_MAJORS.join(" e ")}.`);
  }

  const previous = await readCollectorState(project.root);
  if (previous && isRunning(previous.pid)) {
    warn(`Já existe um Mapa rodando neste projeto (processo ${previous.pid}). Feche-o antes de abrir outro.`);
    return 1;
  }

  const config = readConfig(project.root);
  const collector = await startCollector({
    projectRoot: project.root,
    ...(config.limits ? { limits: config.limits } : {}),
    metadata: () => buildMetadata(project),
    log: (message) => say(message),
    afterSave: async (saved) => {
      // Nothing is sent without login and the first-time confirmation (CLAUDE.md §14).
      const credentials = readCredentials();
      if (!credentials) {
        say("A gravação ficou só neste computador. Para enviá-la ao site do Mapa: npx mapa login e depois npx mapa upload");
        return { status: "local", message: "Ficou só neste computador (rode npx mapa login para enviar)." };
      }
      if (!uploadConsented(project.root)) {
        say("Para enviar esta gravação ao site, rode: npx mapa upload (pede confirmação só na primeira vez)");
        return { status: "local", message: "Ficou só neste computador (rode npx mapa upload para enviar)." };
      }
      const result = await uploadRecording(project, saved.directory, credentials);
      if (result.status === "enviada") say(`Gravação enviada para o site: ${result.url}`);
      else warn(`Não consegui enviar a gravação: ${result.message}. Tente de novo com: npx mapa upload`);
      return result.status === "enviada" ? { status: "enviada", url: result.url! } : { status: "erro", message: result.message ?? "" };
    },
  });
  await writeCollectorState(project.root, {
    url: collector.url,
    port: collector.port,
    pid: process.pid,
    started_at: new Date().toISOString(),
  });

  say(`Next ${project.nextVersion} · ${bundler === "turbopack" ? "Turbopack" : "webpack"} · Node ${process.version}`);
  say(`Coletor pronto em ${collector.url}. Para gravar: npx mapa record start (e depois: npx mapa record stop)`);

  const child = spawn(process.execPath, [project.nextBin, "dev", ...args], {
    cwd: project.root,
    stdio: "inherit",
    env: { ...process.env, MAPA: "1", MAPA_COLLECTOR_URL: collector.url, MAPA_BUNDLER: bundler },
  });

  // Like appmap.yml for appmap-node, config changes apply when the app restarts.
  const configPath = join(project.root, CONFIG_FILE);
  watchFile(configPath, { interval: 1000 }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs) {
      warn(`O ${CONFIG_FILE} mudou. Para valer, feche o Mapa (Ctrl+C) e rode \`npx mapa dev\` de novo.`);
    }
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    unwatchFile(configPath);
    await collector.close();
    await removeCollectorState(project.root);
  };

  // Forward termination signals to Next; we exit (and save any recording) when Next exits.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (child.exitCode === null) child.kill(signal);
    });
  }

  const code = await new Promise<number>((resolve) => {
    child.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 130 : 0)));
    child.on("error", (error) => {
      warn(`Não consegui iniciar o Next: ${error.message}`);
      resolve(1);
    });
  });
  await shutdown();
  return code;
}

/** `.mapa/config.json` (optional). Problems are shown but never block `mapa dev`. */
function readConfig(root: string): MapaConfig {
  let text: string;
  try {
    text = readFileSync(join(root, CONFIG_FILE), "utf8");
  } catch {
    return {};
  }
  try {
    const { config, problems } = parseConfig(JSON.parse(text));
    for (const problem of problems) warn(`${CONFIG_FILE}: ${problem}`);
    return config;
  } catch (error) {
    warn(`${CONFIG_FILE} não é um JSON válido (${(error as Error).message}); usando a configuração padrão.`);
    return {};
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
