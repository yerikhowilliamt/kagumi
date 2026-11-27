import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent rules live in CLAUDE.md; stop `next dev` from writing AGENTS.md.
  agentRules: false,
  // System Design §8 (M5 plan D2). Read at call time, so the development difference is testable.
  async headers() {
    // React's dev tooling needs eval; nothing else differs in development.
    const eval_ = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${eval_}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://res.cloudinary.com",
      "media-src 'self' blob: https://res.cloudinary.com",
      "font-src 'self'",
      "connect-src 'self' https://api.cloudinary.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
