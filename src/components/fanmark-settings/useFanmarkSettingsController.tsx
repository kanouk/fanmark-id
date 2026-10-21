import { useInvalidateOwnedFanmarks } from '@/hooks/useOwnedFanmarks';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { FanmarkSettingsProps, resolveSocialPlatformFromUrl, sanitizePhoneInput, SETTINGS_DRAFT_TTL, SettingsFormData, settingsSchema, isValidHttpUrl, type RedirectLinkType } from './model';

import { SocialLinkInputMode } from '@/components/SocialLinkInputCard';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { saveOwnerFanmarkSettings } from '@/lib/fanmark-settings-api';
import { normalizeSocialUrlForSave, socialPlatforms } from '@/lib/social-platforms';
import type { IconType } from 'react-icons';
import {
FiExternalLink,
FiFileText,
FiGlobe,
FiMoon,
FiPhone,
FiUser
} from 'react-icons/fi';

export function useFanmarkSettingsController({
  fanmark,
  mode = 'dialog',
  open = false,
  onOpenChange,
  onClose,
  onSuccess,
  restoreEditingState,
}: FanmarkSettingsProps) {
  const invalidateOwned = useInvalidateOwnedFanmarks();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      accessType: 'inactive',
      fanmarkName: '',
      targetUrl: '',
      textContent: '',
      createProfile: false,
      isPasswordProtected: false,
      accessPassword: '',
      is_public: false,
      redirectLinkType: 'url',
      redirectPhoneNumber: '',
    },
  });

  const accessType = watch('accessType');
  const watchedRedirectLinkType = watch('redirectLinkType');
  const watchedRedirectPhoneNumber = watch('redirectPhoneNumber');

  const isPasswordProtected = watch('isPasswordProtected');

  const [redirectPlatformKey, setRedirectPlatformKey] = useState<string>('tiktok');
  const [redirectInputMode, setRedirectInputMode] = useState<SocialLinkInputMode>('handle');

  const draftStorageKey = fanmark ? `fanmark_settings_draft_${fanmark.id}` : null;
  // Reset form when fanmark changes or when draft needs hydration
  useEffect(() => {
    if (!fanmark || !draftStorageKey) return;

    const initialPhoneValueRaw = fanmark.access_type === 'redirect' && fanmark.target_url?.startsWith('tel:')
      ? fanmark.target_url.replace(/^tel:/, '')
      : '';
    const initialPhoneValue = sanitizePhoneInput(initialPhoneValueRaw);
    let nextFormData: SettingsFormData = {
      accessType: fanmark.access_type,
      fanmarkName: fanmark.fanmark_name || t('fanmarkSettings.summary.defaultName'),
      targetUrl: fanmark.target_url || '',
      textContent: fanmark.text_content || '',
      createProfile: false,
      isPasswordProtected: fanmark.is_password_protected || false,
      accessPassword: '',
      is_public: fanmark.is_public ?? false,
      redirectLinkType: initialPhoneValue ? 'phone' : 'url',
      redirectPhoneNumber: initialPhoneValue,
    };

    let initialEditing = false;

    try {
      const cached = sessionStorage.getItem(draftStorageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          const { timestamp, data, form, meta } = parsed as {
            timestamp?: number;
            data?: Partial<SettingsFormData>;
            form?: Partial<SettingsFormData>;
            meta?: { isEditingPassword?: boolean };
          };
          if (!timestamp || Date.now() - timestamp <= SETTINGS_DRAFT_TTL) {
            const safeCachedForm = { ...(form ?? data ?? {}) } as Partial<SettingsFormData>;
            const containedPassword = Object.prototype.hasOwnProperty.call(safeCachedForm, 'accessPassword');
            delete safeCachedForm.accessPassword;
            nextFormData = {
              ...nextFormData,
              ...safeCachedForm,
              accessPassword: '',
            };
            if (meta && typeof meta.isEditingPassword === 'boolean') {
              initialEditing = meta.isEditingPassword;
            }
            if (containedPassword) {
              sessionStorage.setItem(draftStorageKey, JSON.stringify({
                timestamp: timestamp ?? Date.now(),
                form: safeCachedForm,
                meta: { isEditingPassword: initialEditing },
              }));
            }
          } else {
            sessionStorage.removeItem(draftStorageKey);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load fanmark settings draft:', error);
    }

    if (restoreEditingState) {
      const safeRestoreState = { ...restoreEditingState };
      delete safeRestoreState.accessPassword;
      nextFormData = {
        ...nextFormData,
        ...safeRestoreState,
        accessPassword: '',
      };
      if (typeof restoreEditingState.isEditingPassword === 'boolean') {
        initialEditing = restoreEditingState.isEditingPassword;
      }
    }

    if (!fanmark.is_password_protected && nextFormData.isPasswordProtected) {
      initialEditing = true;
    }

    reset(nextFormData);
    if (nextFormData.redirectLinkType === 'url') {
      const resolved = resolveSocialPlatformFromUrl(nextFormData.targetUrl);
      setRedirectPlatformKey(resolved.platformKey);
      setRedirectInputMode(resolved.mode);
    }
    if (nextFormData.accessType === 'profile') {
      setValue('createProfile', true, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    }
    setValue('is_public', nextFormData.is_public ?? false, { shouldDirty: false, shouldTouch: false, shouldValidate: false });
    setIsEditingPassword(initialEditing);
    setHydratedDraftKey(draftStorageKey);
  }, [fanmark, draftStorageKey, reset, restoreEditingState, hydratedDraftKey, setValue, t]);

  // Persist draft as the user edits (wait until initial hydration completes)
  useEffect(() => {
    if (!draftStorageKey || hydratedDraftKey !== draftStorageKey) return;
    const subscription = watch((values) => {
      try {
        const safeValues = { ...values };
        delete safeValues.accessPassword;
        sessionStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            timestamp: Date.now(),
            form: safeValues,
            meta: { isEditingPassword },
          })
        );
      } catch (error) {
        console.warn('Failed to persist fanmark settings draft:', error);
      }
    });

    return () => subscription.unsubscribe();
  }, [watch, draftStorageKey, hydratedDraftKey, isEditingPassword]);

  useEffect(() => {
    if (!isPasswordProtected) {
      setIsEditingPassword(false);
    }
  }, [isPasswordProtected]);

  useEffect(() => {
    if (accessType !== 'redirect' || watchedRedirectLinkType !== 'phone') return;
    const sanitized = sanitizePhoneInput(watchedRedirectPhoneNumber);
    const telValue = sanitized ? `tel:${sanitized}` : '';
    const currentUrl = getValues('targetUrl') || '';
    if (currentUrl !== telValue) {
      setValue('targetUrl', telValue, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
    }
  }, [accessType, watchedRedirectLinkType, watchedRedirectPhoneNumber, getValues, setValue]);

  useEffect(() => {
    if (accessType !== 'redirect' || watchedRedirectLinkType !== 'url') return;
    const currentUrl = getValues('targetUrl') || '';
    if (currentUrl.startsWith('tel:')) {
      setValue('targetUrl', '', { shouldDirty: true, shouldTouch: false, shouldValidate: false });
    }
  }, [accessType, watchedRedirectLinkType, getValues, setValue]);

  useEffect(() => {
    if (accessType !== 'redirect' || watchedRedirectLinkType !== 'url') return;
    const resolved = resolveSocialPlatformFromUrl(getValues('targetUrl'));
    setRedirectPlatformKey(resolved.platformKey);
    setRedirectInputMode(resolved.mode);
  }, [accessType, watchedRedirectLinkType, getValues]);

  const handleRedirectPlatformChange = (value: string) => {
    const nextPlatform = socialPlatforms.find((platform) => platform.key === value);
    if (!nextPlatform) return;
    setRedirectPlatformKey(value);
    const nextMode: SocialLinkInputMode = nextPlatform.key === 'website'
      ? 'url'
      : nextPlatform.baseUrl
        ? 'handle'
        : 'url';
    setRedirectInputMode(nextMode);

    const currentUrl = getValues('targetUrl') || '';
    const nextUrl = nextPlatform.baseUrl && currentUrl.startsWith(nextPlatform.baseUrl)
      ? currentUrl
      : nextPlatform.baseUrl
        ? ''
        : isValidHttpUrl(currentUrl)
          ? currentUrl
          : '';
    setValue('targetUrl', nextUrl, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
  };

  const handleClose = () => {
    if (draftStorageKey) {
      try {
        sessionStorage.removeItem(draftStorageKey);
      } catch (error) {
        console.warn('Failed to clear fanmark settings draft:', error);
      }
      setHydratedDraftKey(null);
    }
    if (mode === 'dialog') {
      onOpenChange?.(false);
    } else {
      onClose?.();
    }
  };

  const onSubmit = async (data: SettingsFormData) => {
    if (!fanmark) return;

    setIsSubmitting(true);

    try {
      const normalizedTargetUrl = data.redirectLinkType === 'url'
        ? normalizeSocialUrlForSave(data.targetUrl)
        : data.targetUrl;

      const shouldProtect = data.accessType !== 'inactive' && data.isPasswordProtected;
      const mustEnterPassword = shouldProtect && (!fanmark.is_password_protected || isEditingPassword);
      if (mustEnterPassword && !/^\d{4}$/.test(data.accessPassword ?? '')) {
        toast({
          title: t('fanmarkSettings.toast.errorTitle'),
          description: t('fanmarkSettings.validation.passwordMustBe4Digits'),
          variant: 'destructive',
        });
        return;
      }

      {
        await saveOwnerFanmarkSettings(fanmark.id, {
          fanmarkName: data.fanmarkName,
          accessType: data.accessType,
          ...(data.accessType === 'redirect' ? { targetUrl: normalizedTargetUrl } : {}),
          ...(data.accessType === 'text' ? { textContent: data.textContent || '' } : {}),
          isPasswordProtected: shouldProtect,
          ...(shouldProtect && data.accessPassword ? { accessPassword: data.accessPassword } : {}),
          isPublic: data.is_public,
        });
      }

      void invalidateOwned();
      if (draftStorageKey) {
        sessionStorage.removeItem(draftStorageKey);
        setHydratedDraftKey(null);
      }

      toast({
        title: t('fanmarkSettings.toast.successTitle'),
        description: t('fanmarkSettings.toast.successDescription'),
      });

      onSuccess?.();
      if (mode === 'dialog') {
        onOpenChange?.(false);
      }
    } catch (error) {
      console.error('Settings update error:', error);

      // Check for specific RLS policy violation errors
      let errorMessage = t('fanmarkSettings.toast.errorDescription');

      if (error && typeof error === 'object' && 'code' in error) {
        // PostgreSQL error code 42501 = insufficient privilege (RLS violation)
        if (error.code === '42501') {
          errorMessage = t('fanmarkSettings.errors.licenseExpired');
        }
      }

      toast({
        title: t('fanmarkSettings.toast.errorTitle'),
        description: error instanceof Error ? error.message : errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const accessTypes = [
    {
      value: 'redirect',
      labelKey: 'fanmarkSettings.accessTypeOptions.redirect',
      icon: FiExternalLink,
    },
    {
      value: 'profile',
      labelKey: 'fanmarkSettings.accessTypeOptions.profile',
      icon: FiUser,
    },
    {
      value: 'text',
      labelKey: 'fanmarkSettings.accessTypeOptions.text',
      icon: FiFileText,
    },
    {
      value: 'inactive',
      labelKey: 'fanmarkSettings.accessTypeOptions.inactive',
      icon: FiMoon,
    },
  ];

  const redirectLinkOptions: Array<{
    value: RedirectLinkType;
    labelKey: string;
    descriptionKey: string;
    icon: IconType;
  }> = [
    {
      value: 'url',
      labelKey: 'fanmarkSettings.fields.redirect.linkTypeOptions.url',
      descriptionKey: 'fanmarkSettings.fields.redirect.linkTypeOptions.urlDesc',
      icon: FiGlobe,
    },
    {
      value: 'phone',
      labelKey: 'fanmarkSettings.fields.redirect.linkTypeOptions.phone',
      descriptionKey: 'fanmarkSettings.fields.redirect.linkTypeOptions.phoneDesc',
      icon: FiPhone,
    },
  ];

  // Watch fanmark name for real-time updates
  const watchedFanmarkName = watch('fanmarkName');
  const watchedTextContent = watch('textContent');
  const watchedAccessType = watch('accessType');
  const displayLabel = watchedFanmarkName || fanmark?.fanmark_name || t('fanmarkSettings.summary.defaultName');
  return {
    isSubmitting,
    isEditingPassword,
    setIsEditingPassword,
    t,
    navigate,
    register,
    handleSubmit,
    watch,
    control,
    setValue,
    errors,
    accessType,
    watchedRedirectLinkType,
    isPasswordProtected,
    redirectPlatformKey,
    redirectInputMode,
    setRedirectInputMode,
    handleRedirectPlatformChange,
    handleClose,
    onSubmit,
    accessTypes,
    redirectLinkOptions,
    watchedFanmarkName,
    watchedTextContent,
    watchedAccessType,
    displayLabel,
  };
}
