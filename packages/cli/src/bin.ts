#!/usr/bin/env node
import { dev } from "./dev.js";
import { record } from "./record.js";
import { MapaError } from "./project.js";
import { MAPA_VERSION } from "./version.js";

const HELP = `Mapa ${MAPA_VERSION}: grava o que acontece no seu app Next.js + Supabase.

Uso:
  npx mapa dev [opções do next dev]   liga o app com o Mapa (no lugar de npm run dev)
  npx mapa record start [nome]        começa a gravar
  npx mapa record stop                para e salva em .mapa/recordings/
  npx mapa record status              mostra se está gravando
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case "dev":
      return dev(args);
    case "record":
      return record(args);
    case "--version":
    case "-v":
      console.log(MAPA_VERSION);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    default:
      console.error(`Comando desconhecido: ${command}\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof MapaError) console.error(`[mapa] ${error.message}`);
    else console.error(error);
    process.exit(1);
  },
);
