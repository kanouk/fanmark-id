import React, { useState, useEffect } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface MFAChallengeProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

export const MFAChallenge: React.FC<MFAChallengeProps> = ({ onSuccess, onCancel }) => {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Get the TOTP factor on mount
  useEffect(() => {
    const getFactors = async () => {
      setLoading(true);
      try {
        const { data, error: factorsError } = await supabase.auth.mfa.listFactors();

        if (factorsError) {
          console.error("Failed to list factors:", factorsError);
          setError("認証情報の取得に失敗しました");
          return;
        }

        // Find verified TOTP factor
        const totpFactor = data?.totp?.find((f) => f.status === "verified");
        
        if (totpFactor) {
          setFactorId(totpFactor.id);
        } else {
          setError("有効な二段階認証が見つかりません");
        }
      } catch (err) {
        console.error("Failed to get MFA factors:", err);
        setError("認証情報の取得に失敗しました");
      } finally {
        setLoading(false);
      }
    };

    getFactors();
  }, []);

  const handleVerify = async () => {
    if (!factorId || code.length !== 6) return;

    setVerifying(true);
    setError(null);

    try {
      // Create a challenge
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeError) {
        console.error("MFA challenge error:", challengeError);
        setError("認証チャレンジの作成に失敗しました");
        setVerifying(false);
        return;
      }

      // Verify the code
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code,
      });

      if (verifyError) {
        console.error("MFA verify error:", verifyError);
        setError("コードが正しくありません。もう一度お試しください");
        setCode("");
        setVerifying(false);
        return;
      }

      toast({
        title: "認証成功",
        description: "管理画面にアクセスします",
      });

      onSuccess();
    } catch (err) {
      console.error("MFA verification failed:", err);
      setError("認証に失敗しました");
      setCode("");
    } finally {
      setVerifying(false);
    }
  };

  // Auto-verify when 6 digits are entered
  useEffect(() => {
    if (code.length === 6 && factorId && !verifying) {
      handleVerify();
    }
  }, [code, factorId]);

  if (loading) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">認証情報を確認中...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md overflow-hidden rounded-3xl border border-primary/15 bg-background/90 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10 pb-6 pt-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-background/80 shadow-lg">
          <ShieldCheck className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="mt-4 text-xl">認証コードを入力</CardTitle>
        <CardDescription className="mt-2">
          認証アプリに表示されている6桁のコードを入力してください
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6 px-6 py-8">
        {/* OTP Input */}
        <div className="space-y-3">
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              disabled={verifying || !factorId}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3 pt-2">
          <Button
            onClick={handleVerify}
            disabled={code.length !== 6 || verifying || !factorId}
            className="w-full rounded-full"
          >
            {verifying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                確認中...
              </>
            ) : (
              "確認"
            )}
          </Button>

          {onCancel && (
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={verifying}
              className="w-full"
            >
              ログアウト
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
