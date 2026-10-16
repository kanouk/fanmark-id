import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';

interface TotpLoginChallengeProps {
  code: string;
  onCodeChange: (code: string) => void;
  onVerify: () => Promise<void>;
  onCancel: () => void;
  loading: boolean;
  error: string;
}

export function TotpLoginChallenge({ code, onCodeChange, onVerify, onCancel, loading, error }: TotpLoginChallengeProps) {
  const { t } = useTranslation();
  return (
    <form onSubmit={(event) => { event.preventDefault(); void onVerify(); }} className="space-y-6 rounded-2xl border border-primary/15 bg-background/95 p-6 md:p-8">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t('mfa.challengeTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('mfa.challengeDescription')}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="auth-totp-code">{t('mfa.enterCode')}</Label>
        <Input id="auth-totp-code" name="code" value={code} onChange={(event) => onCodeChange(event.target.value.replace(/\D/gu, '').slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} autoFocus disabled={loading} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" disabled={loading || code.length !== 6}>{t(loading ? 'mfa.verifying' : 'mfa.verifyButton')}</Button>
        <Button type="button" variant="outline" disabled={loading} onClick={onCancel}>{t('mfa.cancel')}</Button>
      </div>
    </form>
  );
}
