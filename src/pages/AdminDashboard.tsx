import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminSettings } from "@/components/AdminSettings";
import { SecureWaitlistAdmin } from "@/components/SecureWaitlistAdmin";
import { AdminPatternRules } from "@/components/AdminPatternRules";
import { AdminExpirationTest } from "@/components/AdminExpirationTest";
import { AdminDataReset } from "@/components/AdminDataReset";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  CalendarClock,
  ClipboardList,
  Clock,
  LineChart,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Settings,
} from "lucide-react";

const AdminDashboard = () => {
  const { signOut } = useAuth();
  const [activeTab, setActiveTab] = React.useState("settings");

  type MetricCard = {
    label: string;
    value: string;
    helper?: string;
    icon: React.ComponentType<{ className?: string }>;
    iconTone: string;
  };

  const navigationCards = [
    {
      value: "settings",
      title: "システム設定",
      description: "ロール、通知、セキュリティポリシーを最新の状態に維持します。",
      icon: Settings,
      accent: "from-primary/20 via-primary/10 to-background",
    },
    {
      value: "waitlist",
      title: "ウェイトリスト",
      description: "承認待ちのファンや招待コードを安全に整理できます。",
      icon: Users,
      accent: "from-blue-200/30 via-blue-100/20 to-background",
    },
    {
      value: "patterns",
      title: "パターンルール",
      description: "許可条件や保護ルールを追加・調整して運用をチューニング。",
      icon: ShieldCheck,
      accent: "from-emerald-200/30 via-emerald-100/20 to-background",
    },
    {
      value: "expiration",
      title: "失効処理",
      description: "安全に失効テストを実行し、公開中の権限を見直します。",
      icon: LineChart,
      accent: "from-orange-200/40 via-orange-100/20 to-background",
    },
  ];

  const insightCards = [
    {
      title: "運用ステータス",
      value: "正常稼働中",
      helper: "全てのサービスが稼働しています",
      accent: "from-emerald-200/30 via-emerald-100/10 to-transparent",
      icon: Activity,
      iconTone: "bg-emerald-500/10 text-emerald-500",
      valueTone: "text-emerald-500",
      tag: "Live",
      tagTone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
    },
    {
      title: "次のメンテナンス",
      value: "調整中",
      helper: "日程が確定すると通知されます",
      accent: "from-amber-200/30 via-amber-100/10 to-transparent",
      icon: CalendarClock,
      iconTone: "bg-amber-500/10 text-amber-500",
      valueTone: "text-amber-500",
      tag: "Scheduled",
      tagTone: "border-amber-500/40 bg-amber-500/10 text-amber-600",
    },
    {
      title: "新着アラート",
      value: "0",
      helper: "重大な対応はありません",
      accent: "from-blue-200/30 via-blue-100/10 to-transparent",
      icon: BellRing,
      iconTone: "bg-blue-500/10 text-blue-500",
      valueTone: "text-blue-500",
      tag: "Alerts",
      tagTone: "border-blue-500/40 bg-blue-500/10 text-blue-600",
    },
  ];

  const systemHighlights: MetricCard[] = [
    {
      label: "通知チャンネル",
      value: "Slack & Email",
      helper: "主要アラートを両方で送信中",
      icon: BellRing,
      iconTone: "bg-primary/10 text-primary",
    },
    {
      label: "ロール設定",
      value: "管理者 2名 / オペレーター 5名",
      helper: "最終更新 2025-03-10",
      icon: Users,
      iconTone: "bg-foreground/10 text-foreground",
    },
    {
      label: "セキュリティログ",
      value: "90日間アーカイブ",
      helper: "監査ログを毎朝バックアップ",
      icon: ShieldCheck,
      iconTone: "bg-emerald-500/10 text-emerald-500",
    },
  ];

  const waitlistStats: MetricCard[] = [
    {
      label: "保留中",
      value: "18 件",
      helper: "レビュー待ちの申請",
      icon: UserPlus,
      iconTone: "bg-blue-500/10 text-blue-500",
    },
    {
      label: "最終更新",
      value: "2 時間前",
      helper: "CSV 同期済み",
      icon: RefreshCw,
      iconTone: "bg-primary/10 text-primary",
    },
    {
      label: "スパム検知率",
      value: "98%",
      helper: "自動レビュー成功率",
      icon: ShieldCheck,
      iconTone: "bg-emerald-500/10 text-emerald-500",
    },
  ];

  const patternStats: MetricCard[] = [
    {
      label: "アクティブルール",
      value: "12",
      helper: "稼働中の許可条件",
      icon: ClipboardList,
      iconTone: "bg-purple-500/10 text-purple-500",
    },
    {
      label: "リスク検知",
      value: "0 件",
      helper: "緊急対応はありません",
      icon: AlertTriangle,
      iconTone: "bg-amber-500/10 text-amber-500",
    },
    {
      label: "最終更新者",
      value: "kanouk",
      helper: "2025-03-12 22:10",
      icon: Users,
      iconTone: "bg-foreground/10 text-foreground",
    },
  ];

  const expirationHighlights: MetricCard[] = [
    {
      label: "失効予約",
      value: "今週 8 件",
      helper: "平日 10:00 実行",
      icon: Clock,
      iconTone: "bg-primary/10 text-primary",
    },
    {
      label: "通知ルール",
      value: "Slack #ops",
      helper: "自動リマインド送信中",
      icon: BellRing,
      iconTone: "bg-blue-500/10 text-blue-500",
    },
    {
      label: "バックアップ",
      value: "完了",
      helper: "毎朝 04:00",
      icon: ShieldCheck,
      iconTone: "bg-emerald-500/10 text-emerald-500",
    },
  ];

  const analyticsHighlights: MetricCard[] = [
    {
      label: "月間発行数",
      value: "124",
      helper: "先月比 +12%",
      icon: BarChart3,
      iconTone: "bg-primary/10 text-primary",
    },
    {
      label: "平均稼働期間",
      value: "46 日",
      helper: "直近 30 日",
      icon: CalendarClock,
      iconTone: "bg-blue-500/10 text-blue-500",
    },
    {
      label: "失効対応",
      value: "100%",
      helper: "SLA 24h 以内",
      icon: LineChart,
      iconTone: "bg-emerald-500/10 text-emerald-500",
    },
  ];

  const patternGuidelines = [
    "高優先度ルールは重複・特別価格を上位に配置する",
    "招待キャンペーン期間中はプレフィックス価格を一時調整",
    "ルール変更後は 5 分以内に検索 API を再起動",
  ];

  const expirationChecklist = [
    "ステージング環境での動作確認（毎週月曜）",
    "失効対象ファンマの CSV をエクスポートしてバックアップ",
    "実行後に監査ログへ記録を残す",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40">
      <header className="border-b bg-gradient-to-r from-primary/10 via-background to-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Fanmark Admin
            </span>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                ファンマーク管理ダッシュボード
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                チームの所有する設定や承認フローを一元管理できます。日次の運用に必要な情報とアクションをここからすぐに確認しましょう。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 self-start lg:self-center">
            <Button variant="secondary" className="gap-2" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              ログアウト
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {navigationCards.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.value;

            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setActiveTab(item.value)}
                aria-pressed={isActive}
                aria-label={`${item.title}セクションを開く`}
                className={`group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 text-left transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`}
              >
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.accent} opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${
                    isActive ? "opacity-100" : ""
                  }`}
                />
                <div className="relative flex h-full flex-col gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-foreground/5 text-foreground transition-colors ${isActive ? "bg-primary text-primary-foreground" : ""}`}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-foreground">{item.title}</h2>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <span className={`mt-auto text-xs font-semibold uppercase tracking-wide ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}>
                    詳細を見る →
                  </span>
                </div>
              </button>
            );
          })}
        </section>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {insightCards.map((card) => {
            const Icon = card.icon;

            return (
              <Card
                key={card.title}
                className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm transition-all hover:shadow-lg"
              >
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.accent}`}
                  aria-hidden
                />
                <CardContent className="relative flex h-full flex-col gap-4 p-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${card.tagTone}`}>
                        {card.tag}
                      </span>
                      <CardTitle className="text-base font-semibold text-foreground">
                        {card.title}
                      </CardTitle>
                    </div>
                    <span className={`flex h-11 w-11 items-center justify-center rounded-full ${card.iconTone}`}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className={`text-3xl font-semibold ${card.valueTone}`}>{card.value}</p>
                    <p className="text-sm text-muted-foreground">{card.helper}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <section>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="flex w-full flex-wrap gap-2 rounded-2xl bg-muted/30 p-2">
              <TabsTrigger
                value="settings"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                システム設定
              </TabsTrigger>
              <TabsTrigger
                value="waitlist"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                ウェイトリスト
              </TabsTrigger>
              <TabsTrigger
                value="patterns"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                パターンルール
              </TabsTrigger>
              <TabsTrigger
                value="expiration"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                失効処理
              </TabsTrigger>
              <TabsTrigger
                value="data-reset"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                データ管理
              </TabsTrigger>
              <TabsTrigger
                value="analytics"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                統計情報
              </TabsTrigger>
            </TabsList>

            <TabsContent value="settings" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    システム設定
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    通知やアクセス制御など、サービス全体に影響する設定を管理します。ロールアウト前後のチェックリストを共有し、変更履歴をチームで把握しましょう。
                  </p>
                </CardHeader>
                <CardContent className="space-y-8 p-6 pt-0">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {systemHighlights.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm"
                        >
                          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${item.iconTone}`}>
                            <Icon className="h-5 w-5" aria-hidden />
                          </span>
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {item.label}
                            </p>
                            <p className="text-base font-semibold text-foreground">{item.value}</p>
                            {item.helper && (
                              <p className="text-xs text-muted-foreground">{item.helper}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-5 text-sm leading-relaxed text-muted-foreground">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-primary">運用メモ</span>
                    <span className="mt-2 block text-foreground">
                      主要な設定変更はデプロイ前日に再確認し、変更内容を Slack の #admin チャンネルへ共有してください。
                    </span>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                    <AdminSettings />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="waitlist" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    ウェイトリスト管理
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    招待申請のレビューと承認フローをここで完結できます。個人情報はハッシュ化されており、必要な場合のみ復号を行ってください。
                  </p>
                </CardHeader>
                <CardContent className="space-y-8 p-6 pt-0">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {waitlistStats.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm"
                        >
                          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${item.iconTone}`}>
                            <Icon className="h-5 w-5" aria-hidden />
                          </span>
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {item.label}
                            </p>
                            <p className="text-base font-semibold text-foreground">{item.value}</p>
                            {item.helper && (
                              <p className="text-xs text-muted-foreground">{item.helper}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-dashed border-blue-400/40 bg-blue-500/5 p-5 text-sm leading-relaxed text-muted-foreground">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-blue-600">
                      インサイト
                    </span>
                    <span className="mt-2 block text-foreground">
                      審査レポートは毎朝 09:00 に自動送付されます。レビュー担当者は保留中の申請を 24 時間以内に判定してください。
                    </span>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                    <SecureWaitlistAdmin />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="patterns" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    パターンルール管理
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    プレミアム条件や除外ロジックを調整して、検索体験と収益バランスを最適化します。変更内容は即時に API へ反映されます。
                  </p>
                </CardHeader>
                <CardContent className="space-y-8 p-6 pt-0">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {patternStats.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm"
                        >
                          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${item.iconTone}`}>
                            <Icon className="h-5 w-5" aria-hidden />
                          </span>
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {item.label}
                            </p>
                            <p className="text-base font-semibold text-foreground">{item.value}</p>
                            {item.helper && (
                              <p className="text-xs text-muted-foreground">{item.helper}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-dashed border-purple-400/30 bg-purple-500/5 p-5 text-sm leading-relaxed text-muted-foreground">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-purple-600">
                      運用ガイドライン
                    </span>
                    <ul className="mt-3 space-y-2 text-foreground">
                      {patternGuidelines.map((item) => (
                        <li key={item} className="flex gap-2 text-sm">
                          <span className="mt-1 h-2 w-2 flex-none rounded-full bg-purple-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                    <AdminPatternRules />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="expiration" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    失効処理のテスト
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    ライセンス失効のシミュレーションを安全に実行し、監査ログを残します。自動化ジョブの稼働状況もここから確認できます。
                  </p>
                </CardHeader>
                <CardContent className="space-y-8 p-6 pt-0">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {expirationHighlights.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm"
                        >
                          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${item.iconTone}`}>
                            <Icon className="h-5 w-5" aria-hidden />
                          </span>
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {item.label}
                            </p>
                            <p className="text-base font-semibold text-foreground">{item.value}</p>
                            {item.helper && (
                              <p className="text-xs text-muted-foreground">{item.helper}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-dashed border-orange-400/40 bg-orange-500/5 p-5 text-sm leading-relaxed text-muted-foreground">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-orange-600">
                      実行チェックリスト
                    </span>
                    <ul className="mt-3 space-y-2 text-foreground">
                      {expirationChecklist.map((item) => (
                        <li key={item} className="flex gap-2 text-sm">
                          <span className="mt-1 h-2 w-2 flex-none rounded-full bg-orange-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                    <AdminExpirationTest />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="data-reset" className="space-y-8">
              <AdminDataReset />
            </TabsContent>

            <TabsContent value="analytics" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    統計情報
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    ファンマ獲得数や失効動向を可視化するダッシュボードです。リアルタイム指標の実装が進行中のため、主要 KPI の概況のみ先行表示しています。
                  </p>
                </CardHeader>
                <CardContent className="space-y-8 p-6 pt-0">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {analyticsHighlights.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm"
                        >
                          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${item.iconTone}`}>
                            <Icon className="h-5 w-5" aria-hidden />
                          </span>
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {item.label}
                            </p>
                            <p className="text-base font-semibold text-foreground">{item.value}</p>
                            {item.helper && (
                              <p className="text-xs text-muted-foreground">{item.helper}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">今後のリリース予定</p>
                        <p className="text-sm text-muted-foreground">
                          週次の発行傾向グラフとティア別の離脱率を追加予定です。実装が完了するまではレポートエクスポートをご利用ください。
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary">
                        <BarChart3 className="h-4 w-4" aria-hidden />
                        In progress
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
                    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                      <div className="space-y-3">
                        <div className="h-48 rounded-xl bg-muted/40" aria-hidden />
                        <p className="text-xs text-muted-foreground">
                          グラフは近日公開予定です。現在は Supabase データから週次レポートを生成しています。
                        </p>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <p className="text-sm font-semibold text-foreground">最新レポート</p>
                          <p className="text-xs text-muted-foreground">2025-03-10 生成 / CSV & PDF</p>
                        </div>
                        <div className="space-y-2 text-xs text-muted-foreground">
                          <p>・ダウンロード: Supabase Storage `/reports/weekly`</p>
                          <p>・共有先: Slack #analytics / Notion ops-db</p>
                          <p>・更新頻度: 毎週月曜 08:30 JST</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
};

export default AdminDashboard;
