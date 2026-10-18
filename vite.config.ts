import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { cpSync, mkdirSync } from "node:fs";
export default defineConfig({
  plugins: [
    vue(),
    {
      name: "bundle-pdf-character-maps",
      closeBundle() {
        mkdirSync("dist/pdf", { recursive: true });
        cpSync("node_modules/pdfjs-dist/cmaps", "dist/pdf/cmaps", {
          recursive: true,
        });
        cpSync(
          "node_modules/pdfjs-dist/standard_fonts",
          "dist/pdf/standard_fonts",
          { recursive: true },
        );
      },
    },
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  build: { chunkSizeWarningLimit: 1800 },
});
