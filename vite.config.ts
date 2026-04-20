import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const chunkGroups: Record<string, string[]> = {
  react: ["react", "react-dom", "react-router-dom"],
  firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/messaging"],
  leaflet: ["leaflet", "react-leaflet"],
  qr: ["html5-qrcode", "qrcode.react"],
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [chunkName, packages] of Object.entries(chunkGroups)) {
            if (packages.some((pkg) => id.includes(`/node_modules/${pkg}/`) || id.includes(`\\node_modules\\${pkg}\\`))) {
              return chunkName;
            }
          }

          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom", "leaflet", "react-leaflet"],
  },
});
