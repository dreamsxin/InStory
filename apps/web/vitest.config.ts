import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    // jsdom is the default because most suites render components; server-only
    // modules opt out with a `@vitest-environment node` pragma.
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"]
  }
});
