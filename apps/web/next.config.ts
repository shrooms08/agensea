import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Pin the workspace root: without this Turbopack walks up past the repo and
// picks a package-lock.json outside it.
const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: here },
};
export default config;
