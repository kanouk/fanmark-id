import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Point staging verification builds at a known-empty directory so they do
  // not implicitly load workstation-specific credentials from mode files.
  envDir: process.env.FANMARK_VITE_ENV_DIR?.trim() || undefined,
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // Build service worker in development mode to bypass terser failures on Node 22
      mode: "development",
      includeAssets: ["favicon.svg", "pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "fanmark.id",
        short_name: "fanmark",
        description: "あなただけのファンマを見つけよう",
        theme_color: "#FFE5E5",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/pwa",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // API responses may contain account state. Only static build assets
        // are cached; requests outside precache go directly to the network.
        importScripts: ["clear-legacy-api-cache.js"],
        navigateFallbackDenylist: [/^\/api(?:[/?]|$)/],
        runtimeCaching: [],
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
