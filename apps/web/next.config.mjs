import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @codelapse/core is TypeScript source in this repository's workspace.
  transpilePackages: ['@codelapse/core', '@codelapse/replay'],
  // Don't write an AGENTS.md into the app folder on every start.
  agentRules: false,
  turbopack: { root: path.join(here, '../..') },
  outputFileTracingRoot: path.join(here, '../..')
};

export default nextConfig;
