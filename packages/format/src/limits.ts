import type { RecordingLimits } from "./types.js";

/** Default recording limits decided in Etapa 0 (docs/decisions.md, docs/spike-report.md). */
export const DEFAULT_LIMITS: RecordingLimits = {
  maxSeconds: 60,
  maxEvents: 50_000,
  maxMegabytes: 12,
  maxCallsPerFunctionPerAction: 50,
};
