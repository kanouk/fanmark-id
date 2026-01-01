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
    const enrollMFA = async () => {
      setLoading(true);
      setError(null);

      try {
        // If a factor already exists, do NOT try to enroll again.
        // - verified: user should go to challenge
        // - unverified: clean it up and re-enroll to show a fresh QR
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();

        if (factorsError) {
          console.error("Failed to list factors:", factorsError);
          setError("認証情報の取得に失敗しました");
          setLoading(false);
          return;
        }

        const verifiedTotp = factorsData?.totp?.find((f) => f.status === "verified");
        if (verifiedTotp) {
          onGoToChallenge?.();
          setLoading(false);
          return;
        }

        const existingTotp = factorsData?.totp?.[0];
        if (existingTotp) {
          // Unenroll leftover/unverified factor so enroll() can succeed
          const { error: unenrollError } = await supabase.auth.mfa.unenroll({
            factorId: existingTotp.id,
          });
          if (unenrollError) {
            console.error("MFA unenroll error:", unenrollError);
            setError("既存の二段階認証設定を解除できませんでした。下のキャンセルからやり直してください。");
            setLoading(false);
            return;
          }
        }

        // Enroll new factor
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Authenticator App",
        });

        if (enrollError) {
          console.error("MFA enroll error:", enrollError);
          setError(enrollError.message);
          return;
        }

        if (data?.totp) {
          setQrCode(data.totp.qr_code);
          setSecret(data.totp.secret);
          setFactorId(data.id);
        }
      } catch (err) {
        console.error("MFA enrollment failed:", err);
        setError("二段階認証の設定に失敗しました");
      } finally {
        setLoading(false);
      }
    };

    enrollMFA();
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
            <div className="rounded-2xl border border-primary/20 bg-white p-4">
              <QRCodeSVG value={qrCode} size={180} level="M" />
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
