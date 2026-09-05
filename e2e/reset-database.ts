import { rmSync } from "node:fs";
import { E2E_DATABASE_PATH } from "../playwright.config.js";

/**
 * Starts every run from an empty database. The suite registers accounts, and a
 * leftover file would make the second run fail on a duplicate email rather than on
 * anything real.
 *
 * Runs from the test:e2e script rather than as Playwright's globalSetup, because
 * Playwright launches the webServer processes *before* globalSetup: the API server
 * has already opened the database by then, and Windows answers EPERM for a file with
 * a live handle.
 */
for (const suffix of ["", "-wal", "-shm"]) {
  removeWithRetries(`${E2E_DATABASE_PATH}${suffix}`);
}

/** Retries because Windows also reports EPERM while a handle is still closing. */
function removeWithRetries(path: string, attempts = 20): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rmSync(path, { force: true });
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw new Error(
          `无法删除 ${path}，可能有残留的服务进程仍在占用它：${(error as Error).message}`
        );
      }
      // Synchronous on purpose: this runs before Playwright, so blocking is fine and
      // keeps the script a plain top-level module.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}
