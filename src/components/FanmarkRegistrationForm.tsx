import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmojiInput } from '@/components/EmojiInput';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { convertEmojiSequenceToIdPair } from '@/lib/emojiConversion';
import { cn } from '@/lib/utils';

type RedirectLinkType = 'url' | 'phone';

const isValidHttpUrl = (value?: string) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const sanitizePhoneInput = (value?: string) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (!digitsOnly) return '';
  return hasPlus ? `+${digitsOnly}` : digitsOnly;
};

const redirectLinkOptions: Array<{
  value: RedirectLinkType;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: 'url',
    labelKey: 'fanmarkSettings.fields.redirect.linkTypeOptions.url',
    descriptionKey: 'fanmarkSettings.fields.redirect.linkTypeOptions.urlDesc',
  },
  {
    value: 'phone',
    labelKey: 'fanmarkSettings.fields.redirect.linkTypeOptions.phone',
    descriptionKey: 'fanmarkSettings.fields.redirect.linkTypeOptions.phoneDesc',
  },
];

const registrationSchema = z.object({
  emojiCombination: z.string().min(1, 'Emoji combination is required'),
  accessType: z.enum(['profile', 'redirect', 'text', 'inactive']),
  displayName: z.string().min(1, 'Display name is required'),
  targetUrl: z.string().trim().optional(),
  textContent: z.string().optional(),
  createProfile: z.boolean().default(false),
  isTransferable: z.boolean().default(true),
  redirectLinkType: z.enum(['url', 'phone']).default('url'),
  redirectPhoneNumber: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.accessType === 'redirect') {
    if (data.redirectLinkType === 'url') {
      if (!data.targetUrl) {
        ctx.addIssue({
          path: ['targetUrl'],
          code: z.ZodIssueCode.custom,
          message: 'Redirect URL is required',
        });
      } else if (!isValidHttpUrl(data.targetUrl)) {
        ctx.addIssue({
          path: ['targetUrl'],
          code: z.ZodIssueCode.custom,
          message: 'Enter a valid http(s) URL',
        });
      }
    } else {
      const sanitized = sanitizePhoneInput(data.redirectPhoneNumber);
      if (!sanitized) {
        ctx.addIssue({
          path: ['redirectPhoneNumber'],
          code: z.ZodIssueCode.custom,
          message: 'Phone number is required',
        });
      } else {
        const expectedTel = `tel:${sanitized}`;
        if (!data.targetUrl || data.targetUrl !== expectedTel) {
          ctx.addIssue({
            path: ['redirectPhoneNumber'],
            code: z.ZodIssueCode.custom,
            message: 'Phone number could not be converted to tel: URI',
          });
        }
      }
    }
  }

  if (data.accessType === 'text' && !data.textContent) {
    ctx.addIssue({
      path: ['textContent'],
      code: z.ZodIssueCode.custom,
      message: 'Text content is required for message boards',
    });
  }
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

interface FanmarkRegistrationFormProps {
  prefilledEmoji?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const FanmarkRegistrationForm = ({ 
  prefilledEmoji, 
  onSuccess, 
  onCancel 
}: FanmarkRegistrationFormProps) => {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useTranslation();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      emojiCombination: prefilledEmoji || '',
      accessType: 'inactive',
      displayName: t('fanmarkSettings.summary.defaultName'),
      targetUrl: '',
      textContent: '',
      createProfile: false,
      isTransferable: true,
      redirectLinkType: 'url',
      redirectPhoneNumber: '',
    },
  });

  const accessType = watch('accessType');
  const redirectLinkType = watch('redirectLinkType');
  const redirectPhoneNumber = watch('redirectPhoneNumber');
  const createProfile = watch('createProfile');

  useEffect(() => {
    if (accessType !== 'redirect' || redirectLinkType !== 'phone') return;
    const sanitized = sanitizePhoneInput(redirectPhoneNumber);
    const telValue = sanitized ? `tel:${sanitized}` : '';
    const currentUrl = getValues('targetUrl') || '';
    if (currentUrl !== telValue) {
      setValue('targetUrl', telValue, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
    }
  }, [accessType, redirectLinkType, redirectPhoneNumber, getValues, setValue]);

  useEffect(() => {
    if (accessType !== 'redirect' || redirectLinkType !== 'url') return;
    const currentUrl = getValues('targetUrl') || '';
    if (currentUrl.startsWith('tel:')) {
      setValue('targetUrl', '', { shouldDirty: true, shouldTouch: false, shouldValidate: false });
    }
  }, [accessType, redirectLinkType, getValues, setValue]);

  const onSubmit = async (data: RegistrationFormData) => {
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

      const { data: result, error } = await supabase.functions.invoke('register-fanmark', {
        body: {
          user_input_fanmark: data.emojiCombination,
          emoji_ids: emojiIds,
          normalized_emoji_ids: normalizedEmojiIds,
          accessType: data.accessType,
          displayName: data.displayName,
          targetUrl: data.targetUrl || null,
          textContent: data.textContent || null,
          createProfile: data.createProfile,
          isTransferable: data.isTransferable,
        },
      });

      if (error) throw error;

      if (result.success) {
        toast({
          title: t('registration.successMessage'),
          description: t('registration.successDescription'),
        });
        onSuccess?.();
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

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl text-center">
          ✨ {t('registration.title')} ✨
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Emoji Combination */}
          <div className="space-y-2">
            <Label htmlFor="emojiCombination" className="text-lg">
              🎯 {t('registration.emojiCombination')}
            </Label>
            {prefilledEmoji ? (
              <Input
                id="emojiCombination"
                {...register('emojiCombination')}
                placeholder={t('registration.placeholders.emojiCombination')}
                className="text-2xl text-center border-2 border-dashed"
                disabled={true}
              />
            ) : (
              <EmojiInput
                value={watch('emojiCombination')}
                onChange={(value) => register('emojiCombination').onChange({ target: { value } })}
                placeholder={t('registration.placeholders.emojiCombination')}
                className="text-2xl text-center border-2 border-dashed"
                maxLength={5}
              />
            )}
            {errors.emojiCombination && (
              <p className="text-sm text-destructive">{errors.emojiCombination.message}</p>
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
              placeholder={t('registration.placeholders.displayName')}
              className="border-2 border-dotted border-pink-300"
            />
            {errors.displayName && (
              <p className="text-sm text-destructive">{errors.displayName.message}</p>
            )}
          </div>

          {/* Access Type */}
          <div className="space-y-3">
            <Label className="text-lg">🎮 {t('registration.accessType')}</Label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'profile', label: t('registration.accessTypes.profile'), desc: t('registration.accessTypes.profileDesc') },
                { value: 'redirect', label: t('registration.accessTypes.redirect'), desc: t('registration.accessTypes.redirectDesc') },
                { value: 'text', label: t('registration.accessTypes.text'), desc: t('registration.accessTypes.textDesc') },
                { value: 'inactive', label: t('registration.accessTypes.inactive'), desc: t('registration.accessTypes.inactiveDesc') },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex items-center space-x-2 p-3 border-2 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
                >
                  <input
                    type="radio"
                    value={option.value}
                    {...register('accessType')}
                    className="radio radio-primary"
                  />
                  <div>
                    <div className="font-medium">{option.label}</div>
                    <div className="text-sm text-gray-500">{option.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Redirect configuration */}
          {accessType === 'redirect' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-lg flex items-center gap-2">
                  🔀 {t('fanmarkSettings.fields.redirect.linkTypeLabel')}
                </Label>
                <p className="text-sm text-muted-foreground">{t('fanmarkSettings.fields.redirect.linkTypeHelper')}</p>
                <div className="grid grid-cols-2 gap-3">
                  {redirectLinkOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setValue('redirectLinkType', option.value, { shouldDirty: true, shouldTouch: true })}
                      className={cn(
                        'rounded-xl border-2 p-3 text-left transition-colors',
                        redirectLinkType === option.value
                          ? 'border-blue-500 bg-blue-50 text-blue-600'
                          : 'border-dashed border-border text-muted-foreground hover:border-blue-300'
                      )}
                    >
                      <div className="font-semibold">{t(option.labelKey)}</div>
                      <div className="text-xs text-muted-foreground">{t(option.descriptionKey)}</div>
                    </button>
                  ))}
                </div>
              </div>

              {redirectLinkType === 'url' && (
                <div className="space-y-2">
                  <Label htmlFor="targetUrl" className="text-lg">
                    🔗 {t('fanmarkSettings.fields.redirect.urlLabel')}
                  </Label>
                  <Input
                    id="targetUrl"
                    {...register('targetUrl')}
                    placeholder={t('fanmarkSettings.fields.redirect.urlPlaceholder')}
                    type="url"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('fanmarkSettings.fields.redirect.urlHelper')}
                  </p>
                  {errors.targetUrl && (
                    <p className="text-sm text-destructive">{errors.targetUrl.message}</p>
                  )}
                </div>
              )}

              {redirectLinkType === 'phone' && (
                <div className="space-y-2">
                  <Label htmlFor="redirectPhoneNumber" className="text-lg">
                    📞 {t('fanmarkSettings.fields.redirect.phoneLabel')}
                  </Label>
                  <Input
                    id="redirectPhoneNumber"
                    {...register('redirectPhoneNumber')}
                    placeholder={t('fanmarkSettings.fields.redirect.phonePlaceholder')}
                    type="tel"
                    inputMode="tel"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('fanmarkSettings.fields.redirect.phoneHelper')}
                  </p>
                  {errors.redirectPhoneNumber && (
                    <p className="text-sm text-destructive">{errors.redirectPhoneNumber.message}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Text Content (for text display) */}
          {accessType === 'text' && (
            <div className="space-y-2">
              <Label htmlFor="textContent" className="text-lg">
                📝 {t('registration.textContent')}
              </Label>
              <Textarea
                id="textContent"
                {...register('textContent')}
                placeholder={t('registration.placeholders.textContent')}
                rows={4}
              />
              {errors.textContent && (
                <p className="text-sm text-destructive">{errors.textContent.message}</p>
              )}
            </div>
          )}

          {/* Create Profile Option */}
          {(accessType === 'profile' || accessType === 'inactive') && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="createProfile"
                {...register('createProfile')}
                className="checkbox checkbox-primary"
              />
              <Label htmlFor="createProfile" className="text-lg">
                🎨 {t('registration.createProfile')}
              </Label>
            </div>
          )}

          {/* Transferability */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="isTransferable"
              {...register('isTransferable')}
              className="toggle toggle-primary"
            />
            <Label htmlFor="isTransferable" className="text-lg">
              🔄 {t('registration.allowTransfers')}
            </Label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-gradient-to-r from-pink-400 to-purple-400 hover:from-pink-500 hover:to-purple-500"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
                  {t('registration.registering')}
                </>
              ) : (
                `🎉 ${t('registration.registerButton')}`
              )}
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
