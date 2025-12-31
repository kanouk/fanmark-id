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
import { convertEmojiSequenceToIdPair } from '@/lib/emojiConversion';

const quickRegistrationSchema = z.object({
  emojiCombination: z.string().min(1, 'Emoji combination is required'),
  fanmarkName: z.string().min(1, 'Fanmark name is required'),
});

type QuickRegistrationFormData = z.infer<typeof quickRegistrationSchema>;

interface RegisteredFanmark {
  id: string;
  user_input_fanmark: string;
  display_fanmark: string;
  emoji_ids?: string[];
  normalized_emoji_ids?: string[];
  fanmark_name: string;
  tier_level?: number;
  tier_display_name?: string | null;
  initial_license_days?: number | null;
}

interface RegisterFanmarkResponse {
  success: boolean;
  fanmark?: {
    id: string;
    user_input_fanmark: string;
    display_fanmark?: string;
    emoji_ids?: string[];
    normalized_emoji_ids?: string[];
    tier_level?: number;
    tier_display_name?: string | null;
    initial_license_days?: number | null;
  };
  error?: string;
}

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
  const [registeredFanmark, setRegisteredFanmark] = useState<RegisteredFanmark | null>(null);
  const { t } = useTranslation();

  const resolveTierLabel = (level?: number) => {
    switch (level) {
      case 1:
        return 'C';
      case 2:
        return 'B';
      case 3:
        return 'A';
      case 4:
        return 'S';
      default:
        return '-';
    }
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<QuickRegistrationFormData>({
    resolver: zodResolver(quickRegistrationSchema),
    defaultValues: {
      emojiCombination: prefilledEmoji || '',
      fanmarkName: '',
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
      const compactEmoji = data.emojiCombination.replace(/\s/g, '');
      let emojiIds: string[] = [];
      let normalizedEmojiIds: string[] = [];
      try {
        const pair = convertEmojiSequenceToIdPair(compactEmoji);
        emojiIds = pair.emojiIds;
        normalizedEmojiIds = pair.normalizedEmojiIds;
      } catch (conversionError) {
        const message = conversionError instanceof Error ? conversionError.message : 'Invalid emoji sequence';
        toast({
          title: t('registration.failed'),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      const { data: result, error } = await supabase.functions.invoke<RegisterFanmarkResponse>('register-fanmark', {
        body: {
          user_input_fanmark: data.emojiCombination,
          emoji_ids: emojiIds,
          normalized_emoji_ids: normalizedEmojiIds,
          accessType: 'inactive',
          displayName: data.fanmarkName,
          defaultFanmarkName: t('fanmarkSettings.summary.defaultName'),
          targetUrl: null,
          textContent: null,
          createProfile: false,
          isTransferable: true,
        },
      });

      if (error) throw error;

      if (result?.success && result.fanmark) {
        setRegisteredFanmark({
          id: result.fanmark.id,
          user_input_fanmark: result.fanmark.user_input_fanmark,
          display_fanmark: result.fanmark.display_fanmark ?? result.fanmark.user_input_fanmark,
          emoji_ids: result.fanmark.emoji_ids,
          normalized_emoji_ids: result.fanmark.normalized_emoji_ids,
          fanmark_name: data.fanmarkName,
          tier_level: result.fanmark.tier_level,
          tier_display_name: result.fanmark.tier_display_name ?? null,
          initial_license_days: result.fanmark.initial_license_days ?? null,
        });
        toast({
          title: t('registration.quickSecured'),
          description: t('registration.quickSecuredDescription'),
        });
      } else {
        throw new Error(result?.error || 'Registration failed');
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
            {registeredFanmark.display_fanmark}
          </div>
          <div className="text-xl font-semibold">
            {registeredFanmark.fanmark_name}
          </div>
          <div className="text-sm text-muted-foreground">
            {t('registration.tierSummary', {
              tier: registeredFanmark.tier_display_name ?? resolveTierLabel(registeredFanmark.tier_level),
              days: registeredFanmark.initial_license_days == null
                ? t('registration.perpetual')
                : t('registration.daysWithUnit', { count: registeredFanmark.initial_license_days }),
            })}
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
              <p className="text-sm text-destructive">{errors.emojiCombination.message}</p>
            )}
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="fanmarkName" className="text-lg">
              ✨ {t('registration.displayName')}
            </Label>
            <Input
              id="fanmarkName"
              {...register('fanmarkName')}
              placeholder={t('registration.placeholders.fanmarkName')}
              className="border-2 border-dotted border-pink-300"
            />
            {errors.fanmarkName && (
              <p className="text-sm text-destructive">{errors.fanmarkName.message}</p>
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
