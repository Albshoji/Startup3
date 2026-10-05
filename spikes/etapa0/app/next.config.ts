import type { NextConfig } from "next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withMapa = require("./mapa-proto/with-mapa.cjs");

const nextConfig: NextConfig = {};

export default withMapa(nextConfig);
