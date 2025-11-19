import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      const hasShownPrompt = localStorage.getItem("pwa_install_prompt_shown");
      if (!hasShownPrompt) {
        setShowPrompt(true);
      }
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      console.log("User accepted the install prompt");
    }

    setDeferredPrompt(null);
    setShowPrompt(false);
    localStorage.setItem("pwa_install_prompt_shown", "true");
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem("pwa_install_prompt_shown", "true");
  };

  if (!showPrompt) return null;

  return (
    <Card className="fixed bottom-20 left-4 right-4 max-w-md mx-auto p-4 shadow-xl z-50 animate-in slide-in-from-bottom-5">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1 hover:bg-muted rounded-full transition-colors"
      >
        <X className="w-4 h-4 text-muted-foreground" />
      </button>

      <div className="flex items-start gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Download className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm mb-1">アプリとしてインストール</p>
          <p className="text-xs text-muted-foreground mb-3">
            ホーム画面から簡単にアクセスできます
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleDismiss}>
              後で
            </Button>
            <Button size="sm" onClick={handleInstall}>
              インストール
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
