import { useState } from 'react';
import { Check, Mail, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from '@/hooks/useTranslation';
import { useInvitationCode, InvitationPerks } from '@/hooks/useInvitationCode';
import { useToast } from '@/hooks/use-toast';

interface InvitationSystemProps {
  onValidCode?: (code: string, perks?: InvitationPerks) => void;
  onReset?: () => void;
}

export function InvitationSystem({ onValidCode, onReset }: InvitationSystemProps) {
  const { t } = useTranslation();
  const { validateCode, validationLoading, joinWaitlist } = useInvitationCode();
  const { toast } = useToast();
  
  const [invitationCode, setInvitationCode] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const [isValidCode, setIsValidCode] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistLoading, setWaitlistLoading] = useState(false);

  const handleCodeValidation = async () => {
    if (!invitationCode.trim()) return;

    const result = await validateCode(invitationCode);
    setValidationMessage(result.message);
    setIsValidCode(result.isValid);

    if (result.isValid) {
      onValidCode?.(invitationCode, result.perks);
    }
  };

  const handleWaitlistJoin = async () => {
    if (!waitlistEmail.trim()) return;

    setWaitlistLoading(true);
    const success = await joinWaitlist(waitlistEmail, 'invitation_page');
    
    if (success) {
      toast({
        title: "✨ " + t('invitation.waitlistSuccess'),
        description: t('invitation.waitlistSuccess'),
      });
      setWaitlistEmail('');
    } else {
      toast({
        title: t('common.error'),
        description: t('common.tryAgain'),
        variant: "destructive",
      });
    }
    setWaitlistLoading(false);
  };

  return (
    <section className="mx-auto w-full max-w-xl space-y-6">
      <div className="rounded-3xl border border-primary/20 bg-background/95 px-6 py-5 shadow-[0_22px_55px_rgba(101,195,200,0.14)] backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-primary/15 p-2.5 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{t('invitation.currentlyInviteOnly')}</p>
            <p className="text-xs text-muted-foreground">{t('invitation.codeRequired')}</p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-primary/15 bg-background/95 p-6 shadow-[0_22px_55px_rgba(101,195,200,0.12)]">
        <h3 className="text-center text-lg font-semibold text-foreground">
          {t('invitation.enterCode')}
        </h3>

        <div className="mt-6 space-y-4">
          <Input
            value={invitationCode}
            onChange={(e) => {
              setInvitationCode(e.target.value.toUpperCase());
              setValidationMessage('');
              setIsValidCode(false);
              onReset?.();
            }}
            placeholder="ABC123"
            className="h-11 rounded-full border-primary/25 bg-background text-center text-base font-medium tracking-[0.3em] text-foreground"
            maxLength={12}
          />

          {validationMessage && (
            <div
              className={`flex items-center justify-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                isValidCode ? 'bg-emerald-50 text-emerald-700' : 'bg-destructive/10 text-destructive'
              }`}
            >
              {isValidCode && <Check className="h-4 w-4" />}
              {validationMessage}
            </div>
          )}

          <Button
            onClick={handleCodeValidation}
            disabled={!invitationCode.trim() || validationLoading}
            className="h-11 w-full rounded-full shadow-none"
          >
            {validationLoading ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                {t('common.loading')}
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                {t('invitation.validate')}
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="relative flex items-center justify-center">
        <span className="h-px w-full bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        <span className="absolute rounded-full bg-background px-3 text-xs font-medium text-muted-foreground">
          or
        </span>
      </div>

      <div className="rounded-3xl border border-muted/20 bg-background/95 p-6 shadow-[0_12px_30px_rgba(101,195,200,0.08)]">
        <h3 className="text-center text-lg font-semibold text-foreground">
          {t('invitation.joinWaitlist')}
        </h3>

        <div className="mt-6 space-y-4">
          <Input
            type="email"
            value={waitlistEmail}
            onChange={(e) => setWaitlistEmail(e.target.value)}
            placeholder={t('invitation.emailPlaceholder')}
            className="h-11 rounded-full border-primary/20 bg-background/90 text-center text-sm"
          />

          <Button
            onClick={handleWaitlistJoin}
            disabled={!waitlistEmail.trim() || waitlistLoading}
            className="w-full rounded-full"
          >
            {waitlistLoading ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                {t('common.loading')}
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                {t('invitation.join')}
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
