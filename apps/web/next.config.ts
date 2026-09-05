import type { NextConfig } from "next";

/**
 * Where the API actually lives. Server-only: the browser never needs it, because
 * browser calls go through the rewrite below and stay on this origin.
 */
const apiTarget = process.env.API_PROXY_TARGET ?? process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@instory/shared"],

  /**
   * Proxies the API under this origin so browser requests are same-origin.
   *
   * The session cookie is host-only on the web origin, so a browser would never
   * attach it to a request aimed at a different API host - which is exactly how
   * "already signed in" turns into 401 as soon as a client component calls the API.
   * Keeping those calls same-origin also sidesteps CORS and SameSite entirely.
   */
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
