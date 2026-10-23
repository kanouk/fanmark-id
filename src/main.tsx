import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { registerSW } from "virtual:pwa-register";
import { installEmojiCatalog } from "@/lib/emojiConversion";
import { loadReusableEmojiCatalog } from "@/lib/emoji-catalog-cache";
import { startEmojiCatalog } from "@/lib/emoji-catalog-state";

const rootElement = document.getElementById("root");

async function loadSelectedEmojiCatalog(): Promise<void> {
  const baseUrl = import.meta.env.VITE_FANMARK_API_BASE_URL?.trim() || window.location.origin;
  if (!baseUrl) throw new Error("Worker API base URL is required for the emoji catalog");

  const pinnedVersion = import.meta.env.VITE_EMOJI_CATALOG_VERSION?.trim();
  const release = await loadReusableEmojiCatalog(baseUrl, {
    ...(pinnedVersion ? { version: pinnedVersion } : {}),
  });
  installEmojiCatalog(release.items);
}

function startApplication(): void {
  if (!rootElement) return;

  // Update checks must also run when catalog startup stalls or fails.
  if ("serviceWorker" in navigator) {
    registerSW({ immediate: true });
  }

  // Fetch alongside React startup; only catalog-dependent operations wait.
  void startEmojiCatalog(loadSelectedEmojiCatalog);

  createRoot(rootElement).render(
    <ThemeProvider defaultTheme="pastel">
      <App />
    </ThemeProvider>,
  );
}

void startApplication();
