import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the browser only talks to Vite, which forwards API calls.
    proxy: { "/api": "http://localhost:3000" },
  },
});
