import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Its own port: browsers keep service workers per address, and other
    // projects on the default 5173 can leave one behind that hijacks this page.
    port: 5180,
    strictPort: true,
    // In development the browser only talks to Vite, which forwards API calls.
    proxy: { "/api": "http://localhost:3000" },
  },
});
