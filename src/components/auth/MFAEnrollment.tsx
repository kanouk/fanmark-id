import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Copy, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface MFAEnrollmentProps {
  onSuccess: () => void;
  onCancel?: () => void;
  onGoToChallenge?: () => void;
}

export const MFAEnrollment: React.FC<MFAEnrollmentProps> = ({ onSuccess, onCancel, onGoToChallenge }) => {
  const { toast } = useToast();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enroll MFA on mount
  useEffect(() => {
    let isMounted = true;

    const enrollMFA = async () => {
      setLoading(true);
      setError(null);

      try {
        // Step 1: List existing factors
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();

        if (factorsError) {
          console.error("Failed to list factors:", factorsError);
          if (isMounted) {
            setError("認証情報の取得に失敗しました");
            setLoading(false);
          }
          return;
        }

        // Step 2: If a verified factor exists, go to challenge screen
        const verifiedTotp = factorsData?.totp?.find((f) => f.status === "verified");
        if (verifiedTotp) {
          if (isMounted) {
            onGoToChallenge?.();
            setLoading(false);
          }
          return;
        }

        // Step 3: Unenroll ALL existing TOTP factors (unverified ones)
        const existingTotpFactors = factorsData?.totp || [];
        for (const factor of existingTotpFactors) {
          console.log(`Unenrolling existing factor: ${factor.id} (${factor.friendly_name})`);
          const { error: unenrollError } = await supabase.auth.mfa.unenroll({
            factorId: factor.id,
          });
          if (unenrollError) {
            console.error("MFA unenroll error:", unenrollError);
            // Continue trying to unenroll others even if one fails
          }
        }

        // Step 4: Wait a moment for unenroll to propagate
        if (existingTotpFactors.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (!isMounted) return;

        // Step 5: Enroll new factor with unique name
        const uniqueName = `Admin Auth ${Date.now()}`;
        console.log(`Enrolling new MFA factor: ${uniqueName}`);
        
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: uniqueName,
        });

        if (enrollError) {
          console.error("MFA enroll error:", enrollError);
          if (isMounted) {
            setError("二段階認証の設定に失敗しました。もう一度お試しください。");
          }
          return;
        }

        if (data?.totp && isMounted) {
          console.log("MFA enroll success, factor ID:", data.id);
          setQrCode(data.totp.qr_code);
          setSecret(data.totp.secret);
          setFactorId(data.id);
        }
      } catch (err) {
        console.error("MFA enrollment failed:", err);
        if (isMounted) {
          setError("二段階認証の設定に失敗しました");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    enrollMFA();

    return () => {
      isMounted = false;
    };
  }, [onGoToChallenge]);

  const handleCopySecret = async () => {
    if (secret) {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleVerify = async () => {
    if (!factorId || code.length !== 6) return;

    setVerifying(true);
    setError(null);

    try {
      // Challenge the factor
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
        title: "二段階認証が有効になりました",
        description: "次回ログイン時から認証コードが必要です",
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
          <p className="mt-4 text-sm text-muted-foreground">二段階認証を準備中...</p>
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
        <CardTitle className="mt-4 text-xl">二段階認証の設定</CardTitle>
        <CardDescription className="mt-2">
          認証アプリ（Google Authenticator、Authy等）でQRコードをスキャンしてください
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6 px-6 py-8">
        {/* QR Code */}
        {qrCode && (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-2xl border border-primary/20 bg-background p-4">
              {qrCode.startsWith('data:') ? (
                <img
                  src={qrCode}
                  alt="二段階認証のQRコード"
                  loading="lazy"
                  className="h-[180px] w-[180px]"
                />
              ) : qrCode.length < 1800 ? (
                <QRCodeSVG value={qrCode} size={180} level="M" />
              ) : (
                <p className="max-w-[240px] text-center text-xs text-muted-foreground">
                  QRコードのデータが長すぎるため表示できません。下のシークレットを手動で入力してください。
                </p>
              )}
            </div>
          </div>
        )}

        {/* Secret for manual entry */}
        {secret && (
          <div className="space-y-2">
            <p className="text-center text-xs text-muted-foreground">
              QRコードをスキャンできない場合は、以下のコードを手動で入力してください
            </p>
            <div className="flex items-center justify-center gap-2">
              <code className="rounded-lg bg-muted px-3 py-2 text-xs font-mono tracking-wider">
                {secret}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopySecret}
                className="h-8 w-8"
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* OTP Input */}
        <div className="space-y-3">
          <p className="text-center text-sm font-medium text-foreground">
            6桁の認証コードを入力
          </p>
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              disabled={verifying}
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
            disabled={code.length !== 6 || verifying}
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
              キャンセル
            </Button>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          管理者アカウントは二段階認証が必須です
        </p>
      </CardContent>
    </Card>
  );
};
