import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { registerSW } from "virtual:pwa-register";

if ("serviceWorker" in navigator) {
  // Register the VitePWA-generated service worker to enable install prompt caching
  registerSW({
    immediate: true,
  });
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="pastel">
    <App />
  </ThemeProvider>
);
