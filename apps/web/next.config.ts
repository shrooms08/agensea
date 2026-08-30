import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Repo root, not apps/web: the hire route imports the proven analyzers and
// ERC-8183 helpers from apps/agents. Their bare imports (@altananetwork/sdk,
// viem) resolve from apps/agents/node_modules, installed on Vercel by the
// installCommand in vercel.json.
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: repoRoot },
};
export default config;
