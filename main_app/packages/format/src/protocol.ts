// Contract between the code annotated by @mapa/babel-plugin and the recorders
// (@mapa/browser-runtime, @mapa/server-runtime), and between the recorders and the collector.

/** Metadata of one annotated function, stored in the per-file table `__mapaFns`. */
export interface FunctionMeta {
  /** AppMap `method_id` */
  id: string;
  /** AppMap `defined_class`: class name, or the file name without extension for loose functions. */
  klass: string;
  /** Relative to the project root, forward slashes. */
  path: string;
  lineno: number;
  static: boolean;
  async: boolean;
  /** Parameter names (`null` when there is no simple name). */
  params: (string | null)[];
  labels: string[];
  /** Index of the `.mapa/config.json` package the file belongs to. */
  pkg: number;
  /** AppMap `shallow`: skip calls from this package to itself. */
  shallow: boolean;
}

/** `globalThis.__mapa`, installed by the recorders and called by the annotated code. */
export interface MapaRuntime {
  /** Records one call of `fn` and returns its result unchanged. */
  r<T>(thisArg: unknown, fn: (...args: unknown[]) => T, args: ArrayLike<unknown>, meta: FunctionMeta): T;
  /** Browser only: current logical frame, saved by async functions that contain `await`. */
  cur?(): unknown;
  /** Browser only: `await x` → `af(frame, await bf(x))`. */
  bf?(value: unknown): Promise<unknown>;
  af?(frame: unknown, box: unknown): unknown;
  /** Browser only: restores a frame (used at each `for await` iteration). */
  rs?(frame: unknown): void;
}

/** Collector endpoint that receives batches of raw events: POST /events?source=<id> (JSON array). */
export const EVENTS_PATH = "/events";
export const RECORD_PATH = "/record";
