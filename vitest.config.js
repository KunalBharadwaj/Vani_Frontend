import { defineConfig } from "vitest/config";
import path from "path";

// Standalone test config (no PWA plugin) with the same "@" alias as vite.config.js.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
  },
});
