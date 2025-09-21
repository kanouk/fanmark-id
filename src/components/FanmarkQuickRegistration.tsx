import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

const quickRegistrationSchema = z.object({
  emojiCombination: z.string().min(1, 'Emoji combination is required'),
  displayName: z.string().min(1, 'Display name is required'),
});

type QuickRegistrationFormData = z.infer<typeof quickRegistrationSchema>;

interface FanmarkQuickRegistrationProps {
  prefilledEmoji?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  onConfigureLater?: () => void;
}

export const FanmarkQuickRegistration = ({ 
  prefilledEmoji, 
  onSuccess, 
  onCancel,
  onConfigureLater
}: FanmarkQuickRegistrationProps) => {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registeredFanmark, setRegisteredFanmark] = useState<any>(null);
  const { t } = useTranslation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<QuickRegistrationFormData>({
    resolver: zodResolver(quickRegistrationSchema),
    defaultValues: {
      emojiCombination: prefilledEmoji || '',
      displayName: '',
    },
  });

  const onSubmit = async (data: QuickRegistrationFormData) => {
    if (!user) {
      toast({
        title: t('registration.authRequired'),
        description: t('registration.authDescription'),
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: result, error } = await supabase.functions.invoke('register-fanmark', {
        body: {
          emoji: data.emojiCombination,
          accessType: 'inactive', // Default to inactive for quick registration
          displayName: data.displayName,
          targetUrl: null,
          textContent: null,
          createProfile: false,
          isTransferable: true,
        },
      });

      if (error) throw error;

      if (result.success) {
        setRegisteredFanmark(result.fanmark);
        toast({
          title: t('registration.quickSecured'),
          description: t('registration.quickSecuredDescription'),
        });
      } else {
        throw new Error(result.error || 'Registration failed');
      }
    } catch (error) {
      console.error('Registration error:', error);
      toast({
        title: t('registration.failed'),
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success state with options
  if (registeredFanmark) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-green-600">
            ✅ {t('registration.successTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-6">
          <div className="text-6xl mb-4">
            {registeredFanmark.emoji_combination}
          </div>
          <div className="text-xl font-semibold">
            {registeredFanmark.display_name}
          </div>
          <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
            {t('registration.quickSecuredInfo')}
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => {
                onConfigureLater?.();
                onSuccess?.();
              }}
              variant="outline"
              className="flex-1"
            >
              {t('registration.configureLater')}
            </Button>
            <Button
              onClick={() => {
                onConfigureLater?.();
                onSuccess?.();
              }}
              className="flex-1 bg-gradient-to-r from-pink-400 to-purple-400 hover:from-pink-500 hover:to-purple-500"
            >
              {t('registration.configureNow')}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl text-center">
          ⚡ {t('registration.quickRegisterTitle')}
        </CardTitle>
        <p className="text-center text-gray-600">
          {t('registration.quickRegisterSubtitle')}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Emoji Combination */}
          <div className="space-y-2">
            <Label htmlFor="emojiCombination" className="text-lg">
              🎯 {t('registration.emojiCombination')}
            </Label>
            <Input
              id="emojiCombination"
              {...register('emojiCombination')}
              placeholder={t('registration.placeholders.emojiCombination')}
              className="text-2xl text-center border-2 border-dashed"
              disabled={!!prefilledEmoji}
            />
            {errors.emojiCombination && (
              <p className="text-sm text-red-500">{errors.emojiCombination.message}</p>
            )}
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName" className="text-lg">
              ✨ {t('registration.displayName')}
            </Label>
            <Input
              id="displayName"
              {...register('displayName')}
              placeholder={t('registration.placeholders.fanmarkName')}
              className="border-2 border-dotted border-pink-300"
            />
            {errors.displayName && (
              <p className="text-sm text-red-500">{errors.displayName.message}</p>
            )}
          </div>

          <div className="bg-yellow-50 rounded-lg p-4 text-sm text-yellow-800">
            {t('registration.detailsNote')}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-gradient-to-r from-green-400 to-blue-400 hover:from-green-500 hover:to-blue-500"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
                  {t('registration.securing')}
                </>
              ) : (
                `⚡ ${t('registration.quickRegister')}`)}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};