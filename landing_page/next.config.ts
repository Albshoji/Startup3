import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Evita que o Next procure lockfiles nas pastas acima desta.
  turbopack: { root: __dirname },
};

export default nextConfig;
