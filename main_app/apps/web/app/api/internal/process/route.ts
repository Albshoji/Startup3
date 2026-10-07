import { timingSafeEqual } from "node:crypto";
import { processDueJobs } from "@/lib/processing";

/** Runs due processing jobs. Called by the worker (scripts/worker.mjs locally; a scheduler in production). */
export async function POST(request: Request) {
  const secret = process.env.MAPA_WORKER_SECRET ?? "";
  const given = request.headers.get("x-mapa-worker-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const processed = await processDueJobs(5);
  return Response.json({ processed });
}
