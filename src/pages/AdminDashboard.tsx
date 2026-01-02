import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminSettings } from "@/components/AdminSettings";
import { AdminExpirationTest } from "@/components/AdminExpirationTest";
import { AdminDataReset } from "@/components/AdminDataReset";
import { AdminPlanSettings } from "@/components/AdminPlanSettings";
import { AdminUserManagement } from "@/components/AdminUserManagement";
import { AdminEmojiMaster } from "@/components/AdminEmojiMaster";
import { AdminTierExtensionPrices } from "@/components/AdminTierExtensionPrices";
import { AdminInvitationManager } from "@/components/AdminInvitationManager";
import { AdminExtensionCoupons } from "@/components/AdminExtensionCoupons";
import AdminNotificationManager from "@/components/AdminNotificationManager";
import AdminEmailTemplates from "@/components/AdminEmailTemplates";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, ShieldCheck, Sparkles } from "lucide-react";

const AdminDashboard = () => {
  const { signOut } = useAuth();
  const [activeTab, setActiveTab] = React.useState("settings");

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
        <section>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="flex w-full flex-wrap gap-2 rounded-2xl bg-muted/30 p-2">
              <TabsTrigger
                value="users"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                ユーザー管理
              </TabsTrigger>
              <TabsTrigger
                value="emoji-master"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                絵文字マスタ
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                システム設定
              </TabsTrigger>
              <TabsTrigger
                value="plan-settings"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                プラン設定
              </TabsTrigger>
              <TabsTrigger
                value="invitations"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                招待管理
              </TabsTrigger>
              <TabsTrigger
                value="tier-extension-prices"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                ティア管理
              </TabsTrigger>
              <TabsTrigger
                value="extension-coupons"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                延長クーポン
              </TabsTrigger>
              <TabsTrigger
                value="expiration"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                失効処理
              </TabsTrigger>
              <TabsTrigger
                value="notifications"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                通知管理
              </TabsTrigger>
              <TabsTrigger
                value="email-templates"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                メールテンプレート
              </TabsTrigger>
              <TabsTrigger
                value="data-reset"
                className="flex-1 rounded-xl px-5 py-3 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground sm:flex-none"
              >
                データ管理
              </TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    ユーザー管理
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    プラン変更、アカウント停止、パスワードリセットを含むユーザー管理操作を行います。操作はすべて監査ログに記録されます。
                  </p>
                </CardHeader>
                <CardContent className="space-y-6 p-6 pt-0">
                  <AdminUserManagement />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="emoji-master" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    絵文字マスタ管理
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    絵文字マスタの表示・インポート・手動修正を行います。既存ユーザー機能に影響を与えないよう運用してください。
                  </p>
                </CardHeader>
                <CardContent className="space-y-6 p-6 pt-0">
                  <AdminEmojiMaster />
                </CardContent>
              </Card>
            </TabsContent>

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
                  <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                    <AdminSettings />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="plan-settings" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    プラン設定
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Business / Enterprise プランの上限と料金を調整します。更新後は関連する課金ロジックに反映されます。
                  </p>
                </CardHeader>
                <CardContent className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                  <AdminPlanSettings />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="invitations" className="space-y-8">
              <AdminInvitationManager />
            </TabsContent>

            <TabsContent value="tier-extension-prices" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    Tier別延長料金設定
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    ファンマークのTierごとに、ライセンス延長期間（1/2/3/6ヶ月）の料金を設定します。変更は即座にユーザーの延長ダイアログに反映されます。
                  </p>
                </CardHeader>
                <CardContent className="space-y-6 p-6 pt-0">
                  <AdminTierExtensionPrices />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="extension-coupons" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    延長クーポン管理
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    ライセンス延長用のクーポンを発行・管理します。クーポンは課金と並行して使用でき、対象ティアや使用回数を制限できます。
                  </p>
                </CardHeader>
                <CardContent className="space-y-6 p-6 pt-0">
                  <AdminExtensionCoupons />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="expiration" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    失効バッチ管理
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    失効バッチの手動実行と実行履歴をここで管理します。手動起動は直近のバッチと同じエッジ関数を呼び出します。
                  </p>
                </CardHeader>
                <CardContent className="space-y-8 p-6 pt-0">
                  <AdminExpirationTest />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notifications" className="space-y-8">
              <AdminNotificationManager />
            </TabsContent>

            <TabsContent value="email-templates" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    メールテンプレート管理
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    認証メール（サインアップ確認・パスワードリセットなど）の件名・本文・ボタンテキストを言語別に編集できます。
                  </p>
                </CardHeader>
                <CardContent className="space-y-6 p-6 pt-0">
                  <AdminEmailTemplates />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="data-reset" className="space-y-8">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="space-y-3 p-6 pb-4">
                  <CardTitle className="text-xl font-semibold text-foreground">
                    データ管理
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    開発・テスト用のファンマークデータ一括削除を行います。実行前に影響範囲を必ず確認してください。
                  </p>
                </CardHeader>
                <CardContent className="space-y-8 p-6 pt-0">
                  <AdminDataReset />
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
