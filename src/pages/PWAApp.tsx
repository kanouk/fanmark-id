import { useState, useEffect } from "react";
import { Search, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import FanmarkSearch from "@/components/FanmarkSearch";
import { useFanmarkHistory } from "@/hooks/useFanmarkHistory";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";

type TabType = "search" | "history";

export default function PWAApp() {
  const [activeTab, setActiveTab] = useState<TabType>("search");
  const { history, addToHistory, clearHistory } = useFanmarkHistory();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const path = window.location.pathname;
    if (path.includes("/history")) {
      setActiveTab("history");
    } else {
      setActiveTab("search");
    }
  }, []);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    window.history.pushState({}, "", `/pwa/${tab}`);
  };

  const handleSearchResult = (result: any) => {
    if (result?.status === "taken" && result?.shortId && searchQuery) {
      addToHistory(searchQuery, result.shortId);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      <PWAInstallPrompt />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-center">fanmark.id</h1>
          <p className="text-sm text-muted-foreground text-center mt-1">
            {activeTab === "search" ? "ファンマを検索" : "検索履歴"}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {activeTab === "search" && (
            <div className="space-y-4">
              <Card className="p-4">
                <FanmarkSearch
                  query={searchQuery}
                  onResultChange={handleSearchResult}
                  onQueryChange={setSearchQuery}
                  showRecent={false}
                />
              </Card>
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              {history.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">最近の検索</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearHistory}
                      className="text-destructive hover:text-destructive"
                    >
                      すべて削除
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {history.map((item) => (
                      <Card key={item.shortId} className="p-0 overflow-hidden">
                        <a
                          href={`/${item.shortId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors"
                        >
                          <span className="text-3xl">{item.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {item.shortId}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(item.searchedAt, {
                                addSuffix: true,
                                locale: ja,
                              })}
                            </p>
                          </div>
                        </a>
                      </Card>
                    ))}
                  </div>
                </>
              ) : (
                <Card className="p-8 text-center">
                  <History className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground">検索履歴がありません</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    ファンマを検索すると、ここに履歴が表示されます
                  </p>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Tab Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border">
        <div className="max-w-2xl mx-auto flex">
          <button
            onClick={() => handleTabChange("search")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
              activeTab === "search"
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Search className="w-5 h-5" />
            <span className="text-xs font-medium">検索</span>
          </button>

          <button
            onClick={() => handleTabChange("history")}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
              activeTab === "history"
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="w-5 h-5" />
            <span className="text-xs font-medium">履歴</span>
          </button>
        </div>
      </div>
    </div>
  );
}
