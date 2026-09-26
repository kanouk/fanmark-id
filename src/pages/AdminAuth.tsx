import React, { useMemo, useState, useEffect } from "react";
import { Home, Lock, Mail, ShieldAlert, LogIn, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MFAEnrollment } from "@/components/auth/MFAEnrollment";
import { MFAChallenge } from "@/components/auth/MFAChallenge";
import { QRCodeSVG } from "qrcode.react";
import { betterAuthClient, isBetterAuthEnabled } from "@/lib/auth-backend";
import { useAuth } from "@/hooks/useAuth";

type MFAStep = "login" | "enroll" | "challenge";

// Get the main site URL (user-facing site, not admin subdomain)
const getMainSiteUrl = (): string => {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const port = window.location.port;

  // Development environment
  if (hostname === "localhost" || hostname.includes("127.0.0.1")) {
    // Remove ?admin=true param and return to main site
    return `${protocol}//${hostname}${port ? `:${port}` : ""}/`;
  }

  // Production environment - remove subdomain (e.g., admin.fanmark.id -> fanmark.id)
  const parts = hostname.split(".");
  if (parts.length > 2) {
    // Remove first part (subdomain)
    const mainDomain = parts.slice(1).join(".");
    return `${protocol}//${mainDomain}/`;
  }

  // Fallback
  return `${protocol}//${hostname}/`;
};

interface AdminAuthProps {
  onMFAComplete?: () => void;
}

const SupabaseAdminAuth: React.FC<AdminAuthProps> = ({ onMFAComplete }) => {
  const mainSiteUrl = useMemo(() => getMainSiteUrl(), []);
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaStep, setMfaStep] = useState<MFAStep>("login");
  const [checkingMFA, setCheckingMFA] = useState(false);

  // If already signed in (e.g., AdminRoute re-renders), skip the login form and go straight to MFA.
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setCheckingMFA(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;

        if (!data.session) {
          return;
        }

        const mfaStatus = await checkMFAStatus();
        if (!mounted) return;

        if (mfaStatus === "complete") {
          onMFAComplete?.();
        } else if (mfaStatus === "challenge") {
          setMfaStep("challenge");
        } else {
          setMfaStep("enroll");
        }
      } finally {
        if (mounted) setCheckingMFA(false);
      }
    };

    init();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check MFA status after login
  const checkMFAStatus = async (): Promise<"enroll" | "challenge" | "complete"> => {
    try {
      // Get AAL level
      const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalError) {
        console.error("Failed to get AAL:", aalError);
        return "enroll";
      }

      // If already at AAL2, MFA is complete
      if (aalData?.currentLevel === "aal2") {
        return "complete";
      }

      // Check if user has enrolled factors
      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();

      if (factorsError) {
        console.error("Failed to list factors:", factorsError);
        return "enroll";
      }

      // Check for verified TOTP factor
      const hasVerifiedTOTP = factorsData?.totp?.some((f) => f.status === "verified");

      if (hasVerifiedTOTP) {
        // User has MFA set up, needs to verify
        return "challenge";
      } else {
        // User needs to enroll MFA
        return "enroll";
      }
    } catch (err) {
      console.error("Error checking MFA status:", err);
      return "enroll";
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        toast({
          title: "ログインに失敗しました",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "ログインしました",
        description: "二段階認証を確認しています…",
      });

      // Check MFA status
      setCheckingMFA(true);
      const mfaStatus = await checkMFAStatus();

      if (mfaStatus === "complete") {
        // Already at AAL2, proceed to admin
        onMFAComplete?.();
      } else if (mfaStatus === "challenge") {
        // Need to verify existing MFA
        setMfaStep("challenge");
      } else {
        // Need to enroll MFA
        setMfaStep("enroll");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "ログインに失敗しました";
      setError(message);
      toast({
        title: "ログインに失敗しました",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setCheckingMFA(false);
    }
  };

  const handleMFASuccess = () => {
    onMFAComplete?.();
  };

  const handleMFACancel = async () => {
    // Sign out and reset to login
    await supabase.auth.signOut();
    setMfaStep("login");
    setEmail("");
    setPassword("");
  };

  const handleMFAReset = () => {
    // After unenrolling MFA, go to enroll screen
    setMfaStep("enroll");
  };

  // Render MFA enrollment screen
  if (mfaStep === "enroll") {
    return (
      <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <SimpleHeader className="border-border/40 bg-background/80 backdrop-blur-xl" />
        <main className="flex flex-1 items-center justify-center px-4 py-12">
          <MFAEnrollment
            onSuccess={handleMFASuccess}
            onCancel={handleMFACancel}
            onGoToChallenge={() => setMfaStep("challenge")}
          />
        </main>
        <SiteFooter className="border-primary/20 bg-background/80 backdrop-blur" />
      </div>
    );
  }

  // Render MFA challenge screen
  if (mfaStep === "challenge") {
    return (
      <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <SimpleHeader className="border-border/40 bg-background/80 backdrop-blur-xl" />
        <main className="flex flex-1 items-center justify-center px-4 py-12">
          <MFAChallenge 
            onSuccess={handleMFASuccess} 
            onCancel={handleMFACancel} 
            onResetMFA={handleMFAReset}
          />
        </main>
        <SiteFooter className="border-primary/20 bg-background/80 backdrop-blur" />
      </div>
    );
  }

  // Render login form
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <SimpleHeader className="border-border/40 bg-background/80 backdrop-blur-xl" />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <Card className="overflow-hidden rounded-3xl border border-primary/15 bg-background/90 shadow-[0_28px_70px_rgba(101,195,200,0.18)] backdrop-blur-md">
            <div className="relative bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10 px-8 py-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.4),transparent_50%)]" />
              <div className="relative text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-background/80 shadow-lg">
                  <ShieldAlert className="h-10 w-10 text-primary" />
                </div>
              </div>
            </div>

            <CardContent className="px-8 py-10">
              <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">管理者ログイン</h1>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                admin サブドメインは通常サイトと別オリジンのため、管理画面側でもログインが必要です。
              </p>

              <form onSubmit={handleSignIn} className="mt-8 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="admin-email" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Mail className="h-4 w-4" /> メール
                  </Label>
                  <Input
                    id="admin-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    className="h-11 rounded-2xl border border-primary/15 bg-background/80"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admin-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Lock className="h-4 w-4" /> パスワード
                  </Label>
                  <Input
                    id="admin-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="h-11 rounded-2xl border border-primary/15 bg-background/80"
                  />
                </div>

                {error && (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <Button type="submit" disabled={loading || checkingMFA} className="w-full gap-2 rounded-full">
                  {loading || checkingMFA ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {checkingMFA ? "認証確認中…" : "ログイン中…"}
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" />
                      ログイン
                    </>
                  )}
                </Button>

                <div className="flex justify-center pt-2">
                  <Button variant="outline" className="gap-2 rounded-full" asChild>
                    <a href={mainSiteUrl}>
                      <Home className="h-4 w-4" /> トップに戻る
                    </a>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>

      <SiteFooter className="border-primary/20 bg-background/80 backdrop-blur" />
    </div>
  );
};

type CloudflareAdminStep = "login" | "enroll" | "verify-enrollment" | "challenge" | "checking" | "denied";

const CloudflareAdminAuth: React.FC<AdminAuthProps> = ({ onMFAComplete }) => {
  const { user, refreshSession } = useAuth();
  const [step, setStep] = useState<CloudflareAdminStep>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Awaited<ReturnType<typeof betterAuthClient.enableTotp>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyAdminSessionState = async () => {
    const result = await betterAuthClient.getAdminSession();
    if (result.authorized) {
      setStep("checking");
      onMFAComplete?.();
    } else if ("reason" in result && result.reason === "mfa_enrollment_required") {
      setStep("enroll");
    } else if ("reason" in result && result.reason === "mfa_required") {
      setStep("challenge");
    } else if ("reason" in result && result.reason === "admin_required") {
      setStep("denied");
    } else {
      setStep("login");
    }
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    void betterAuthClient.getAdminSession().then((result) => {
      if (!active) return;
      if (result.authorized) {
        setStep("checking");
        onMFAComplete?.();
      } else if ("reason" in result && result.reason === "mfa_enrollment_required") {
        setStep("enroll");
      } else if ("reason" in result && result.reason === "mfa_required") {
        setStep("challenge");
      } else if ("reason" in result && result.reason === "admin_required") {
        setStep("denied");
      } else {
        setStep("login");
      }
    }).catch(() => {
      if (active) {
        setError("管理者認証を確認できません。時間をおいて再度お試しください。");
        setStep("login");
      }
    });
    return () => { active = false; };
  }, [user, onMFAComplete]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await betterAuthClient.signInWithEmail(email, password);
      if ("twoFactorRedirect" in result && result.twoFactorRedirect) {
        setStep("challenge");
        return;
      }
      await refreshSession();
      await applyAdminSessionState();
    } catch {
      setError("メールアドレスまたはパスワードを確認してください。");
    } finally {
      setBusy(false);
    }
  };

  const handleEnableTotp = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await betterAuthClient.enableTotp(password));
      setCode("");
      setStep("verify-enrollment");
    } catch {
      setError("認証アプリの設定を開始できませんでした。パスワードを確認するか、認証コードを入力してください。");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyTotp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await betterAuthClient.verifyTotp(code);
      await refreshSession();
      await applyAdminSessionState();
      setCode("");
    } catch {
      setError("認証コードを確認できませんでした。新しいコードを入力してください。");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (step === "denied") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-destructive" />
            <h1 className="text-xl font-semibold">管理者権限がありません</h1>
            <p className="mt-2 text-sm text-muted-foreground">このアカウントには管理画面へのアクセス権がありません。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p>管理者認証を確認しています…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <SimpleHeader className="border-border/40 bg-background/80 backdrop-blur-xl" />
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-xl overflow-hidden rounded-3xl border border-primary/15 bg-background/90 shadow-lg">
          <CardContent className="space-y-6 px-8 py-8">
            <div className="text-center">
              <ShieldAlert className="mx-auto mb-3 h-9 w-9 text-primary" />
              <h1 className="text-2xl font-semibold">管理者ログイン</h1>
              <p className="mt-2 text-sm text-muted-foreground">Cloudflare Auth と管理者 MFA で確認します。</p>
            </div>

            {step === "login" && (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cloudflare-admin-email">メールアドレス</Label>
                  <Input id="cloudflare-admin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cloudflare-admin-password">パスワード</Label>
                  <Input id="cloudflare-admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                </div>
                <Button type="submit" disabled={busy} className="w-full gap-2 rounded-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  ログイン
                </Button>
              </form>
            )}

            {step === "enroll" && (
              <form onSubmit={handleEnableTotp} className="space-y-4">
                <p className="text-sm text-muted-foreground">管理画面には認証アプリの設定が必要です。</p>
                <div className="space-y-2">
                  <Label htmlFor="cloudflare-enroll-password">パスワードを再入力</Label>
                  <Input id="cloudflare-enroll-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                </div>
                <Button type="submit" disabled={busy} className="w-full rounded-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "認証アプリを設定"}
                </Button>
              </form>
            )}

            {step === "verify-enrollment" && enrollment && (
              <form onSubmit={handleVerifyTotp} className="space-y-4">
                <div className="flex justify-center rounded-xl bg-white p-4">
                  <QRCodeSVG value={enrollment.totpURI} size={192} />
                </div>
                <p className="text-center text-sm text-muted-foreground">認証アプリで QR コードを読み取り、6 桁のコードを入力してください。</p>
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="mb-2 text-sm font-medium">復旧コード（この画面でのみ表示）</p>
                  <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                    {enrollment.backupCodes.map((backupCode) => <span key={backupCode}>{backupCode}</span>)}
                  </div>
                </div>
                <Input aria-label="認証コード" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} required />
                <Button type="submit" disabled={busy || code.length !== 6} className="w-full rounded-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "認証して続行"}
                </Button>
              </form>
            )}

            {step === "challenge" && (
              <form onSubmit={handleVerifyTotp} className="space-y-4">
                <p className="text-sm text-muted-foreground">認証アプリの 6 桁コードを入力してください。</p>
                <Input aria-label="認証コード" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} required />
                <Button type="submit" disabled={busy || code.length !== 6} className="w-full rounded-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "認証して続行"}
                </Button>
              </form>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-center">
              <Button variant="outline" className="gap-2 rounded-full" asChild>
                <a href={getMainSiteUrl()}><Home className="h-4 w-4" />トップに戻る</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
      <SiteFooter className="border-primary/20 bg-background/80 backdrop-blur" />
    </div>
  );
};

const AdminAuth: React.FC<AdminAuthProps> = (props) => (
  isBetterAuthEnabled() ? <CloudflareAdminAuth {...props} /> : <SupabaseAdminAuth {...props} />
);

export default AdminAuth;
