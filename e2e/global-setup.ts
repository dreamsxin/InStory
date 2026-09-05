import { rmSync } from "node:fs";
import { E2E_DATABASE_PATH } from "../playwright.config.js";

/**
 * Starts every run from an empty database. The suite registers accounts, and a
 * leftover file would make the second run fail on a duplicate email rather than on
 * anything real.
 */
export default function globalSetup(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${E2E_DATABASE_PATH}${suffix}`, { force: true });
  }
}
