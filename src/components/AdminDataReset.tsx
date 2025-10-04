import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ResetResult {
  success: boolean;
  deletedCounts: {
    fanmark_basic_configs: number;
    fanmark_redirect_configs: number;
    fanmark_messageboard_configs: number;
    fanmark_password_configs: number;
    fanmark_profiles: number;
    fanmark_favorites: number;
    fanmark_licenses: number;
    fanmarks: number;
  };
  totalDeleted: number;
}

export const AdminDataReset = () => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const { toast } = useToast();

  const handleReset = async () => {
    setIsResetting(true);
    setResetResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('reset-fanmark-data', {
        method: 'POST',
      });

      if (error) throw error;

      setResetResult(data as ResetResult);
      toast({
        title: "データリセット完了",
        description: `${data.totalDeleted} 件のレコードを削除しました`,
      });
    } catch (error) {
      console.error('Reset error:', error);
      toast({
        title: "エラー",
        description: "データのリセットに失敗しました",
        variant: "destructive",
      });
    } finally {
      setIsResetting(false);
      setIsDialogOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            ファンマークデータの一括削除
          </CardTitle>
          <CardDescription>
            開発・テスト用：すべてのファンマーク関連データを削除します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              この操作は以下のデータを削除します：
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>ファンマーク本体</li>
                <li>ライセンス情報</li>
                <li>基本設定・リダイレクト設定</li>
                <li>メッセージボード・パスワード設定</li>
                <li>プロフィール・お気に入り</li>
              </ul>
              <div className="mt-3 font-semibold text-green-600 dark:text-green-400">
                ✓ 保持されるデータ：ユーザーアカウント、システム設定、招待コード、ウェイトリスト
              </div>
            </AlertDescription>
          </Alert>

          <Button
            variant="destructive"
            onClick={() => setIsDialogOpen(true)}
            disabled={isResetting}
            className="w-full"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {isResetting ? "削除中..." : "ファンマークデータを削除"}
          </Button>

          {resetResult && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription>
                <div className="font-semibold mb-2">削除完了（合計: {resetResult.totalDeleted} 件）</div>
                <ul className="text-sm space-y-1">
                  <li>fanmarks: {resetResult.deletedCounts.fanmarks}</li>
                  <li>fanmark_licenses: {resetResult.deletedCounts.fanmark_licenses}</li>
                  <li>fanmark_basic_configs: {resetResult.deletedCounts.fanmark_basic_configs}</li>
                  <li>fanmark_redirect_configs: {resetResult.deletedCounts.fanmark_redirect_configs}</li>
                  <li>fanmark_messageboard_configs: {resetResult.deletedCounts.fanmark_messageboard_configs}</li>
                  <li>fanmark_password_configs: {resetResult.deletedCounts.fanmark_password_configs}</li>
                  <li>fanmark_profiles: {resetResult.deletedCounts.fanmark_profiles}</li>
                  <li>fanmark_favorites: {resetResult.deletedCounts.fanmark_favorites}</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">本当に削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この操作は取り消せません。すべてのファンマーク関連データが完全に削除されます。
              <div className="mt-2 font-semibold">
                ユーザーアカウントとシステム設定は保持されます。
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              className="bg-destructive hover:bg-destructive/90"
            >
              削除を実行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
