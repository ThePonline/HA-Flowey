import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

// Builds a single ES module that Home Assistant loads as a custom panel.
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: path("../custom_components/ha_flow_builder/static"),
    emptyOutDir: true,
    // Bundled libraries are MIT-licensed; their notices ship next to the bundle.
    license: { fileName: "THIRD_PARTY_LICENSES.md" },
    minify: true,
    rolldownOptions: { output: { minify: true } },
    lib: {
      entry: path("src/main.tsx"),
      formats: ["es"],
      fileName: () => "flow_builder.js",
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
