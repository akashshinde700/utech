import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Proxy ALL traffic to the UTech ERP backend (Express on 127.0.0.1:4000).
  // The ERP SPA (served by the backend from backend/public) is the only UI
  // exposed through the sandbox preview (port 81 -> Caddy -> 3000).
  // NOTE: the negative-lookahead source '/((?!_next).*)' does NOT forward
  // paths correctly on Next 16 + Turbopack (unnamed capture groups get
  // index names, ':path*' stays empty -> every request hits the backend
  // root). The two-rule form below was verified end-to-end instead.
  // Services (mariadbd + Express backend) are spawned by src/instrumentation.ts.

  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "http://127.0.0.1:4000/" },
        { source: "/:path*", destination: "http://127.0.0.1:4000/:path*" },
      ],
    };
  },
};

export default nextConfig;
