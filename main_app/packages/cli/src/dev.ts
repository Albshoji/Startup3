import { spawn } from "node:child_process";
import { readCollectorState, removeCollectorState, startCollector, writeCollectorState } from "@mapa/collector";
import { buildMetadata } from "./metadata.js";
import {
  detectBundler,
  findNextProject,
  nodeMajor,
  SUPPORTED_NEXT_MAJORS,
  SUPPORTED_NODE_MAJORS,
} from "./project.js";
import { say, warn } from "./output.js";

/** `mapa dev [next dev args]`: starts the collector and `next dev` with MAPA=1. */
export async function dev(args: string[]): Promise<number> {
  const project = findNextProject(process.cwd());
  const bundler = detectBundler(project.nextMajor, args);

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

  const collector = await startCollector({
    projectRoot: project.root,
    metadata: () => buildMetadata(project),
    log: (message) => say(message),
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

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
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

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
