import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The public address, used in link-preview tags, which must be absolute.
// Defaults to the expected Render address; set SITE_URL when building for
// another domain (e.g. SITE_URL=https://dragonpunchedle.com npm run build).
const siteUrl = (process.env.SITE_URL ?? "https://dragonpunchedle.onrender.com").replace(/\/$/, "");

function siteUrlPlugin(): Plugin {
  return {
    name: "site-url",
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", siteUrl),
    // Search engines need full addresses here too, so these two files are
    // written at build time instead of living in public/.
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source:
          `<?xml version="1.0" encoding="UTF-8"?>
` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
` +
          `  <url><loc>${siteUrl}/</loc><changefreq>daily</changefreq></url>
` +
          `  <url><loc>${siteUrl}/privacy.html</loc><changefreq>monthly</changefreq></url>
` +
          `</urlset>
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), siteUrlPlugin()],
  build: {
    // The password-strength checker's word lists make one large file on
    // purpose. It loads only when someone opens the sign-up form, so the
    // game itself stays small. The limit sits just above it to catch real growth.
    chunkSizeWarningLimit: 1800,
  },
  server: {
    // Its own port: browsers keep service workers per address, and other
    // projects on the default 5173 can leave one behind that hijacks this page.
    port: 5180,
    strictPort: true,
    // In development the browser only talks to Vite, which forwards API calls.
    proxy: { "/api": "http://localhost:3000" },
  },
});
