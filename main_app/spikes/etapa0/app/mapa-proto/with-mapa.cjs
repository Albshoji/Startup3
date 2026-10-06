// SPIKE (Etapa 0) — withMapa(nextConfig). Inert unless MAPA=1.
"use strict";
const path = require("node:path");

const loader = path.join(__dirname, "loader.cjs");
const GLOB = "*.{js,jsx,ts,tsx,mjs,cjs}";

module.exports = function withMapa(nextConfig = {}) {
  if (process.env.MAPA !== "1") return nextConfig;

  const turbopack = { ...(nextConfig.turbopack || {}) };
  const rules = { ...(turbopack.rules || {}) };
  const ours = [
    {
      condition: { all: ["browser", { not: "foreign" }] },
      loaders: [{ loader, options: { layer: "browser" } }],
    },
    {
      condition: { all: [{ not: "browser" }, { not: "foreign" }] },
      loaders: [{ loader, options: { layer: "server" } }],
    },
  ];
  if (process.env.MAPA_LIB_AWAITS === "1") {
    // Only mark `await` points (no function recording) inside supabase-js, so the
    // logical stack survives its internal awaits before `fetch`.
    ours.push({
      condition: { all: ["browser", "foreign", { path: /node_modules[\\/]@supabase[\\/]/ }] },
      loaders: [{ loader, options: { layer: "browser", awaitsOnly: true } }],
    });
  }
  const existing = rules[GLOB];
  rules[GLOB] = existing ? [...ours, ...(Array.isArray(existing) ? existing : [existing])] : ours;
  turbopack.rules = rules;

  const userWebpack = nextConfig.webpack;
  return {
    ...nextConfig,
    turbopack,
    webpack(config, context) {
      if (userWebpack) config = userWebpack(config, context);
      const layer = context.isServer ? "server" : "browser";
      config.module.rules.push({
        test: /\.(js|jsx|ts|tsx|mjs|cjs)$/,
        exclude: /node_modules/,
        enforce: "pre",
        use: [{ loader, options: { layer } }],
      });
      return config;
    },
  };
};
