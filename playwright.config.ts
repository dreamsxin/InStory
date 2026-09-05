import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const API_PORT = 4000;
const WEB_PORT = 3000;

/**
 * Absolute on purpose: `npm run -w` runs the server with its own workspace as the
 * working directory, so a relative path would resolve somewhere the global setup
 * does not clean.
 */
export const E2E_DATABASE_PATH = join(process.cwd(), "data", "e2e.sqlite");

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
  globalSetup: "./e2e/global-setup.ts",
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run start -w apps/server",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        NODE_ENV: "production",
        PORT: String(API_PORT),
        HOST: "127.0.0.1",
        SQLITE_DATABASE_PATH: E2E_DATABASE_PATH,
        ADMIN_TOKEN: "e2e-admin-token-0123456789abcdef0123456789abcdef",
        LLM_PROVIDER: "mock",
        DAILY_TURN_QUOTA: "20"
      }
    },
    {
      command: "npm run dev -w apps/web",
      url: `http://127.0.0.1:${WEB_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(WEB_PORT),
        NEXT_PUBLIC_API_BASE: `http://127.0.0.1:${API_PORT}`,
        ADMIN_TOKEN: "e2e-admin-token-0123456789abcdef0123456789abcdef"
      }
    }
  ]
});
