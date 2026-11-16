import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent rules live in CLAUDE.md; stop `next dev` from writing AGENTS.md.
  agentRules: false,
};

export default nextConfig;
