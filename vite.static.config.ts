import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offlineBuild } from "./scripts/offline-build";
export default defineConfig({
  plugins: [react(), offlineBuild()],
  publicDir: false,
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: "site-dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 3000, strictPort: true },
});
