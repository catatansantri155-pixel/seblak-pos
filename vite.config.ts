import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend Seblak POS (Vite + React). Saat pengembangan, /api diteruskan ke
// `wrangler dev` (Worker) di http://localhost:8787.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
