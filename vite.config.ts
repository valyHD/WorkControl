import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const chunkGroups: Record<string, string[]> = {
  react: ["react", "react-dom", "react-router-dom"],
  firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/messaging"],
  leaflet: ["leaflet", "react-leaflet"],
  qrReader: ["html5-qrcode"],
  qrCode: ["qrcode.react"],
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [chunkName, packages] of Object.entries(chunkGroups)) {
            if (
              packages.some(
                (pkg) =>
                  id.includes(`/node_modules/${pkg}/`) || id.includes(`\\node_modules\\${pkg}\\`)
              )
            ) {
              return chunkName;
            }
          }

          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom"],
  },
});
