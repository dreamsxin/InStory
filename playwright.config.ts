import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Deliberately not 4000/3000: those belong to `npm run dev`. Sharing them meant a
 * run had to kill the developer's servers first, and a browser left open on
 * localhost:3000 would silently start showing the throwaway test database - test
 * stories appearing and then vanishing looks exactly like data loss.
 */
const API_PORT = 4100;
const WEB_PORT = 3100;


/**
 * Absolute on purpose: `npm run -w` runs the server with its own workspace as the
 * working directory, so a relative path would resolve somewhere the global setup
 * does not clean.
 */
export const E2E_DATABASE_PATH = join(process.cwd(), "data", "e2e.sqlite");

/** Where the suite's own API answers. Specs set up state through it. */
export const E2E_API_BASE = `http://127.0.0.1:${API_PORT}`;

/**
 * End-to-end coverage for the paths only a real browser can exercise: form
 * submission through server actions, cookie round-trips, and streamed narration.
 *
 * The API runs in production mode so the legacy anonymous fallback is off and the
 * unauthenticated redirect is real. The web app runs in dev mode on purpose: a
 * production build would set Secure cookies, which a browser refuses over http.
 */
export default defineConfig({
  testDir: "./e2e",
  // The database is reset by the test:e2e script, not here: Playwright starts the
  // webServer processes before globalSetup, so by then the API holds the file open.
  // Registration writes to a shared database, so tests share state deliberately.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "on-first-retry",
    // The UI is Chinese; keep the browser locale aligned with it.
    locale: "zh-CN"
  },
  projects: [
    {
      name: "chrome",
      // Uses the Chrome already installed on the machine instead of Playwright's
      // bundled Chromium, so a run needs no browser download. Override with
      // PLAYWRIGHT_CHANNEL="" to fall back to the bundled build.
      use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" }
    }
  ],
  webServer: [
    {
      command: "npm run start -w apps/server",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      // Still never reuse: the ports are the suite's own, so anything already
      // listening on them is a leftover process from an interrupted run, and reusing
      // it would mean testing against a database this run did not reset.
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "production",
        PORT: String(API_PORT),
        HOST: "127.0.0.1",
        SQLITE_DATABASE_PATH: E2E_DATABASE_PATH,
        // Explicit even though production defaults it off: the suite counts the cards
        // on the shelf, so demo stories appearing would break unrelated tests.
        SEED_DEMO_DATA: "false",
        ADMIN_TOKEN: "e2e-admin-token-0123456789abcdef0123456789abcdef",
        LLM_PROVIDER: "mock",
        // Without a pause the mock finishes within a frame and the in-progress
        // reader state is never observable, so the streaming UI goes untested.
        MOCK_STREAM_CHUNK_DELAY_MS: "60",
        // Small on purpose: lets a six-turn session exercise "load older turns"
        // without generating dozens of passages first. Still above the two turns the
        // other reader specs rely on being present after a reload.
        SESSION_TURN_WINDOW: "5",
        // The whole suite registers from one address, which the default 10-per-minute
        // limit is meant to stop. Raised so adding a test cannot fail unrelated ones.
        AUTH_ATTEMPTS_PER_MINUTE: "500",
        GENERATION_BURST_PER_MINUTE: "200",
        DAILY_TURN_QUOTA: "20"
      }
    },
    {
      command: "npm run dev -w apps/web",
      url: `http://127.0.0.1:${WEB_PORT}/login`,
      // Same reason as the API: the port is the suite's own, and a reused server
      // carries different env, so the suite would be testing a different
      // configuration than the one it declares.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(WEB_PORT),
        // Its own build directory, so this dev server and the developer's can run at
        // the same time (Next allows only one dev server per build directory).
        NEXT_DIST_DIR: ".next-e2e",
        // Both the /api rewrite and the server-side fetches read this.
        API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
        ADMIN_TOKEN: "e2e-admin-token-0123456789abcdef0123456789abcdef"
      }
    }
  ]
});
