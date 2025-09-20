import { useState } from 'react';
import { Check, Mail, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from '@/hooks/useTranslation';
import { useInvitationCode } from '@/hooks/useInvitationCode';
import { useToast } from '@/hooks/use-toast';

interface InvitationSystemProps {
  onValidCode?: (code: string, perks?: any) => void;
}

export function InvitationSystem({ onValidCode }: InvitationSystemProps) {
  const { t } = useTranslation();
  const { validateCode, validationLoading, joinWaitlist } = useInvitationCode();
  const { toast } = useToast();
  
  const [invitationCode, setInvitationCode] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const [isValidCode, setIsValidCode] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);
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
      setShowWaitlist(false);
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
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Invitation Banner */}
      <Alert className="border-yellow-200 bg-yellow-50">
        <Sparkles className="h-4 w-4 text-yellow-600" />
        <AlertDescription className="text-yellow-800 font-medium text-center">
          {t('invitation.currentlyInviteOnly')}
        </AlertDescription>
      </Alert>

      {/* Invitation Code Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-center text-lg">
            {t('invitation.enterCode')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Input
              value={invitationCode}
              onChange={(e) => {
                setInvitationCode(e.target.value.toUpperCase());
                setValidationMessage('');
                setIsValidCode(false);
              }}
              placeholder="ABC123"
              className="text-center text-lg font-mono tracking-widest"
              maxLength={12}
            />
            
            {validationMessage && (
              <div className={`text-sm text-center ${isValidCode ? 'text-green-600' : 'text-red-600'}`}>
                {isValidCode && <Check className="w-4 h-4 inline mr-1" />}
                {validationMessage}
              </div>
            )}
          </div>

          <Button
            onClick={handleCodeValidation}
            disabled={!invitationCode.trim() || validationLoading}
            className="w-full"
          >
            {validationLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {t('invitation.codeValidation')}
              </>
            ) : (
              <>
              <Check className="w-4 h-4 mr-2" />
              {t('invitation.validate')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Waitlist Option */}
      {!showWaitlist ? (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center">
            <p className="text-base-content/70 mb-3">
              {t('invitation.enterCode')}?
            </p>
            <Button 
              variant="outline" 
              onClick={() => setShowWaitlist(true)}
              className="w-full"
            >
              <Mail className="w-4 h-4 mr-2" />
              {t('invitation.joinWaitlist')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-center text-lg">
              {t('invitation.joinWaitlist')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="email"
              value={waitlistEmail}
              onChange={(e) => setWaitlistEmail(e.target.value)}
              placeholder={t('invitation.emailPlaceholder')}
              className="text-center"
            />
            
            <div className="flex space-x-2">
              <Button
                variant="outline"
                onClick={() => setShowWaitlist(false)}
                className="flex-1"
              >
                {t('invitation.back')}
              </Button>
              <Button
                onClick={handleWaitlistJoin}
                disabled={!waitlistEmail.trim() || waitlistLoading}
                className="flex-1"
              >
                {waitlistLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    {t('common.loading')}
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4 mr-2" />
                    {t('invitation.join')}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}