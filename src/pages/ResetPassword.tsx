import { usePasswordReset } from "@/hooks/usePasswordReset";
import { usePasswordValidation } from "@/hooks/usePasswordValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/AuthLayout";
import { PasswordRequirement } from "@/components/PasswordRequirement";

const ResetPassword = () => {
  const {
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isLoading,
    isValidSession,
    resetPassword
  } = usePasswordReset();
  
  const { requirements, isValid } = usePasswordValidation(password);

  if (!isValidSession) {
    return (
      <AuthLayout 
        title="セッション確認中..." 
        description="パスワードリセット権限を確認しています。"
      >
        <div className="text-center space-y-4">
          <div className="text-6xl">🔒</div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout 
      title="パスワード再設定" 
      description="新しいパスワードを入力してください"
      showBackButton
      backTo="/auth"
      backLabel="ログイン画面に戻る"
    >
      <form onSubmit={(e) => { e.preventDefault(); resetPassword(); }} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">新しいパスワード</Label>
          <Input
            id="password"
            type="password"
            placeholder="8文字以上のパスワード"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {password && (
            <div className="space-y-1 p-3 bg-muted/50 rounded-md">
              <p className="text-sm font-medium text-muted-foreground mb-2">パスワード要件:</p>
              {requirements.map((req, index) => (
                <PasswordRequirement key={index} met={req.met} text={req.text} />
              ))}
            </div>
          )}
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">パスワード確認</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="パスワードを再入力"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          {confirmPassword && password !== confirmPassword && (
            <p className="text-sm text-destructive">パスワードが一致しません</p>
          )}
        </div>
        
        <Button 
          type="submit" 
          className="w-full" 
          disabled={isLoading || !isValid || password !== confirmPassword}
        >
          {isLoading ? "更新中..." : "パスワードを更新"}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default ResetPassword;