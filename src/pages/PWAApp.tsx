import { useState, useEffect, useMemo } from "react";
import { Search, History, ExternalLink, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import FanmarkSearch from "@/components/FanmarkSearch";
import { useFanmarkHistory } from "@/hooks/useFanmarkHistory";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { PWAHeader } from "@/components/layout/PWAHeader";
import { useTranslation } from "@/hooks/useTranslation";
import { FanmarkSearchPanel } from "@/components/FanmarkSearchPanel";
import { EmojiInputUtilities } from "@/components/EmojiInput";
import { extractEmojiString } from "@/lib/emojiConversion";
import { useToast } from "@/hooks/use-toast";
import { navigateToFanmark } from "@/utils/emojiUrl";

type TabType = "search" | "history";

export default function PWAApp() {
  const [activeTab, setActiveTab] = useState<TabType>("search");
  const [searchResult, setSearchResult] = useState<any>(null);
  const { history, addToHistory, clearHistory } = useFanmarkHistory();
  const [searchQuery, setSearchQuery] = useState("");
  const { t } = useTranslation();
  const { toast } = useToast();

  // 同じファンマ（emoji）は1つだけ表示するように重複を排除
  const uniqueHistory = useMemo(() => {
    const seen = new Set<string>();
    return history.filter((item) => {
      if (seen.has(item.emoji)) {
        return false;
      }
      seen.add(item.emoji);
      return true;
    });
  }, [history]);

  useEffect(() => {
    const path = window.location.pathname;
    if (path.includes("/history")) {
      setActiveTab("history");
    } else {
      setActiveTab("search");
    }
  }, []);

  const handleSearchResult = (result: any) => {
    setSearchResult(result);
    if (result?.status === "taken" && result?.shortId && searchQuery) {
      addToHistory(searchQuery, result.shortId);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard) {
        toast({
          title: t("common.error"),
          description: t("common.clipboardNotSupported"),
          variant: "destructive",
        });
        return;
      }
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        toast({
          title: t("common.clipboardEmptyTitle"),
          description: t("common.clipboardEmptyBody"),
          variant: "warning",
        });
        return;
      }
      const extracted = extractEmojiString(clipboardText);
      if (!extracted) {
        toast({
          title: t("common.nonEmojiRejectedTitle"),
          description: t("common.nonEmojiRejectedBody"),
          variant: "warning",
        });
        return;
      }
      setSearchQuery(extracted);
      toast({
        title: t("common.pasteCompletedTitle"),
        description: t("common.pasteCompleted"),
      });
    } catch (error) {
      console.error("Failed to paste emoji:", error);
      toast({
        title: t("common.error"),
        description: t("common.clipboardReadFailed"),
        variant: "destructive",
      });
    }
  };

  const handleClearQuery = () => {
    setSearchQuery("");
    toast({
      title: t("common.clearCompletedTitle"),
    });
  };

  const handleDirectInput = (value: string) => {
    const extracted = extractEmojiString(value);
    setSearchQuery(extracted ?? value);
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col font-sans text-foreground bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      {/* Background Decoration (from Index.tsx) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="hero-decorative-blob -top-20 -left-20 w-96 h-96 bg-primary/20" style={{animationDelay: '0s'}} />
        <div className="hero-decorative-blob top-1/4 -right-20 w-80 h-80 bg-accent/20" style={{animationDelay: '3s'}} />
        <div className="hero-decorative-blob bottom-0 left-1/3 w-72 h-72 bg-blue-400/10" style={{animationDelay: '6s'}} />
      </div>

      {/* Header - PWA Style */}
      <PWAHeader />

      {/* Content Area */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 pb-24 pt-4 overflow-y-auto scrollbar-hide z-10 relative">
        {activeTab === "search" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <FanmarkSearchPanel
              label=""
              icon={<Search className="h-6 w-6 text-primary" />}
              title={t("dashboard.searchFanma")}
              contentClassName="px-4 sm:px-6 pb-6"
            >
              {/* ファンマ入力グループ - 入力と便利ツールが一体 */}
              <div className="mt-6 mb-10 space-y-6">
                <FanmarkSearch
                  query={searchQuery}
                  onResultChange={handleSearchResult}
                  onQueryChange={setSearchQuery}
                  showRecent={false}
                  fixedSize={true}
                />

                {/* 便利ツール - レスポンシブ間隔 */}
                <div className="flex justify-center">
                  <EmojiInputUtilities
                    disabled={false}
                    hasValue={!!(searchResult?.fanmark || searchResult?.user_input_fanmark || searchQuery)}
                    onPaste={handlePasteFromClipboard}
                    onClear={handleClearQuery}
                    onDirectInput={handleDirectInput}
                    value={searchQuery}
                    fixedSize={true}
                  />
                </div>

                {/* ファンマアクセスボタン */}
                {searchQuery && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="default"
                      className="h-10 rounded-xl px-4"
                      onClick={() => {
                        // 履歴に追加
                        const shortId = searchResult?.shortId || searchQuery;
                        addToHistory(searchQuery, shortId);
                        // ファンマページへ移動
                        navigateToFanmark(searchQuery, true);
                      }}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      <span>{t("dashboard.visitFanmarkButton")}</span>
                    </Button>
                  </div>
                )}
              </div>
            </FanmarkSearchPanel>
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">検索履歴</h2>
              {uniqueHistory.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearHistory}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 px-3 text-xs rounded-full"
                >
                  履歴をクリア
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {uniqueHistory.length > 0 ? (
                uniqueHistory.map((item, idx) => (
                  <div key={item.shortId} className="group" style={{ animationDelay: `${idx * 50}ms` }}>
                    <a
                      href={`/${item.shortId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Card className="p-4 border border-border/40 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 bg-white/90 rounded-2xl flex items-center gap-4 group-hover:border-primary/40">
                        <div className="min-w-[4rem] h-12 bg-muted/40 rounded-xl flex items-center justify-center px-2">
                          <span className="text-2xl leading-none select-none whitespace-nowrap overflow-hidden" style={{ letterSpacing: '0.2em' }}>
                            {item.emoji.slice(0, 5)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(item.searchedAt, {
                              addSuffix: true,
                              locale: ja,
                            })}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground/50 group-hover:text-primary/50 transition-colors" />
                      </Card>
                    </a>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 space-y-4 opacity-80">
                  <div className="w-16 h-16 bg-white/80 border border-border/40 rounded-full flex items-center justify-center mx-auto">
                    <History className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-foreground text-sm font-medium">まだ検索履歴がありません</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      ファンマを検索すると、ここに控えめに表示されます
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </main>

    </div>
  );
}
