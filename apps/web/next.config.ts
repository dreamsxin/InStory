import type { NextConfig } from "next";

/**
 * Where the API actually lives. Server-only: the browser never needs it, because
 * browser calls go through the rewrite below and stay on this origin.
 */
const apiTarget = process.env.API_PROXY_TARGET ?? process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@instory/shared"],

  /**
   * A dev server refuses to start when another one is already running for the same
   * build directory, whatever port it was given. The e2e suite runs its own web
   * server, so it points this elsewhere (`.next-e2e`) and the two coexist - a test
   * run no longer requires killing the developer's dev server.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",


  /**
   * The dev server only serves /_next/* to origins it recognises, and it does not
   * treat 127.0.0.1 as the same origin as localhost. Without this the client bundle
   * is refused when the app is opened on 127.0.0.1: the markup renders but nothing
   * hydrates, so every button silently does nothing. Dev-only setting.
   */
  allowedDevOrigins: ["localhost", "127.0.0.1"],


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
