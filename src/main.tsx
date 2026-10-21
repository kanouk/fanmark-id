import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { registerSW } from "virtual:pwa-register";
import { installEmojiCatalog } from "@/lib/emojiConversion";
import { loadEmojiCatalogFromWorker } from "@/lib/emoji-catalog-worker";

const rootElement = document.getElementById("root");

function showCatalogLoading(): void {
  if (!rootElement) return;
  const main = document.createElement("main");
  main.className = "min-h-screen grid place-items-center px-6 text-center";
  const status = document.createElement("div");
  status.className = "flex flex-col items-center gap-4";
  status.setAttribute("role", "status");
  const spinner = document.createElement("span");
  spinner.className = "h-8 w-8 rounded-full border-2 border-primary/25 border-t-primary motion-safe:animate-spin";
  spinner.setAttribute("aria-hidden", "true");
  const message = document.createElement("p");
  message.className = "text-sm text-muted-foreground";
  message.textContent = "絵文字カタログを読み込んでいます…";
  status.append(spinner, message);
  main.append(status);
  rootElement.replaceChildren(main);
}

function showCatalogStartupError(): void {
  if (!rootElement) return;
  const main = document.createElement("main");
  main.className = "min-h-screen grid place-items-center px-6 text-center";
  main.setAttribute("role", "alert");
  const content = document.createElement("div");
  const heading = document.createElement("h1");
  heading.className = "text-xl font-semibold";
  heading.textContent = "絵文字カタログを読み込めませんでした";
  const message = document.createElement("p");
  message.className = "mt-3 text-sm text-muted-foreground";
  message.textContent = "通信状態を確認して、もう一度お試しください。";
  const retry = document.createElement("button");
  retry.className = "mt-6 rounded-md bg-primary px-4 py-2 text-primary-foreground";
  retry.textContent = "再読み込み";
  retry.addEventListener("click", () => window.location.reload());
  content.append(heading, message, retry);
  main.append(content);
  rootElement.replaceChildren(main);
}

async function loadSelectedEmojiCatalog(): Promise<void> {
  const baseUrl = import.meta.env.VITE_FANMARK_API_BASE_URL?.trim() || window.location.origin;
  if (!baseUrl) throw new Error("Worker API base URL is required for the emoji catalog");

  const pinnedVersion = import.meta.env.VITE_EMOJI_CATALOG_VERSION?.trim();
  const release = await loadEmojiCatalogFromWorker(baseUrl, {
    ...(pinnedVersion ? { version: pinnedVersion } : {}),
  });
  installEmojiCatalog(release.items);
}

async function startApplication(): Promise<void> {
  if (!rootElement) return;

  // Update checks must also run when catalog startup stalls or fails.
  if ("serviceWorker" in navigator) {
    registerSW({ immediate: true });
  }

  showCatalogLoading();

  try {
    await loadSelectedEmojiCatalog();
  } catch {
    showCatalogStartupError();
    return;
  }

  createRoot(rootElement).render(
    <ThemeProvider defaultTheme="pastel">
      <App />
    </ThemeProvider>,
  );
}

void startApplication();
