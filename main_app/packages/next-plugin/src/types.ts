export interface LoaderOptions {
  layer: "browser" | "server";
  /** Absolute path of the user's project (where next.config and .mapa/ live). */
  root: string;
  /**
   * Hash of `.mapa/config.json` and of the plugin code. Turbopack caches transformed files across
   * restarts, keyed by loader options: a new fingerprint makes it transform them again.
   */
  fingerprint?: string;
  /** Library files: only mark awaits (see @mapa/babel-plugin `awaitsOnly`). */
  awaitsOnly?: boolean;
}
