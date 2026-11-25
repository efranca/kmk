/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { appVersion, commitCount, shortCommit } from "./scripts/appVersion";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Fixed when the app is built: shown in Settings > About.
  define: {
    __APP_VERSION__: JSON.stringify(appVersion(pkg.version, commitCount())),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(shortCommit()),
  },
  plugins: [react()],
  // Two pages: the signed-in app and the public quote form (served at /devis).
  build: { rollupOptions: { input: { main: fileURLToPath(new URL("./index.html", import.meta.url)), quote: fileURLToPath(new URL("./quote.html", import.meta.url)) } } },
  server: { proxy: { "/api": "http://127.0.0.1:8001" } },
  test: { environment: "jsdom", setupFiles: ["./src/setup.ts"], globals: true },
});
