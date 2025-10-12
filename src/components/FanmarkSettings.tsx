import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Eye, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  FiType, 
  FiSettings, 
  FiExternalLink, 
  FiEdit3, 
  FiRepeat, 
  FiSave,
  FiAlertCircle,
  FiUser,
  FiFileText,
  FiMoon,
  FiImage,
  FiLock
} from 'react-icons/fi';
import { Checkbox } from '@/components/ui/checkbox';

type AccessType = 'profile' | 'redirect' | 'text' | 'inactive';

const settingsSchema = z.object({
  accessType: z.enum(['profile', 'redirect', 'text', 'inactive']),
  fanmarkName: z.string().min(1, 'Fanmark name is required'),
  targetUrl: z.string().url().optional().or(z.literal('')),
  textContent: z.string().optional(),
  createProfile: z.boolean().default(false),
  isPasswordProtected: z.boolean().default(false),
  accessPassword: z.string().optional(),
  is_public: z.boolean().default(false),
}).refine((data) => {
  if (data.accessType === 'redirect' && !data.targetUrl) {
    return false;
  }
  // 伝言板のメッセージは空でも保存可能にする
  // if (data.accessType === 'text' && !data.textContent) {
  //   return false;
  // }
  if (data.accessType !== 'inactive' && data.isPasswordProtected && data.accessPassword && !/^\d{4}$/.test(data.accessPassword)) {
    return false;
  }
  return true;
}, {
  message: 'Please fill in required fields for selected access type',
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export interface Fanmark {
  id: string;
  user_input_fanmark: string;
  emoji_ids?: string[];
  fanmark?: string;
  fanmark_name: string | null;
  access_type: AccessType;
  target_url?: string;
  text_content?: string;
  is_password_protected?: boolean;
  status: string;
  short_id: string;
  license_id: string;
}

interface FanmarkSettingsProps {
  fanmark: Fanmark | null;
  mode?: 'dialog' | 'page';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  onSuccess?: () => void;
  restoreEditingState?: any;
}

export const FanmarkSettings = ({
  fanmark,
  mode = 'dialog',
  open = false,
  onOpenChange,
  onClose,
  onSuccess,
  restoreEditingState,
}: FanmarkSettingsProps) => {
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
    formState: { errors },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
  });

  const accessType = watch('accessType');

  const isPasswordProtected = watch('isPasswordProtected');

  const draftStorageKey = fanmark ? `fanmark_settings_draft_${fanmark.id}` : null;
  const DRAFT_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // Reset form when fanmark changes or when draft needs hydration
  useEffect(() => {
    if (!fanmark || !draftStorageKey) return;

    const shouldHydrateFromRestore = Boolean(restoreEditingState);
    if (!shouldHydrateFromRestore && hydratedDraftKey === draftStorageKey) {
      return;
    }

    let nextFormData: SettingsFormData = {
      accessType: fanmark.access_type,
      fanmarkName: fanmark.fanmark_name || t('fanmarkSettings.summary.defaultName'),
      targetUrl: fanmark.target_url || '',
      textContent: fanmark.text_content || '',
      createProfile: false,
      isPasswordProtected: fanmark.is_password_protected || false,
      accessPassword: '',
    };

    let initialEditing = false;

    if (restoreEditingState) {
      nextFormData = {
        ...nextFormData,
        ...restoreEditingState,
      };

      if (typeof restoreEditingState.isEditingPassword === 'boolean') {
        initialEditing = restoreEditingState.isEditingPassword;
      }
    }

    try {
      const cached = localStorage.getItem(draftStorageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          const { timestamp, data, form, meta } = parsed as {
            timestamp?: number;
            data?: Partial<SettingsFormData>;
            form?: Partial<SettingsFormData>;
            meta?: { isEditingPassword?: boolean };
          };
          const draftPayload = form ?? data;
          if (!timestamp || Date.now() - timestamp <= DRAFT_TTL) {
            if (draftPayload) {
              nextFormData = {
                ...nextFormData,
                ...draftPayload,
              };
            }
            if (meta && typeof meta.isEditingPassword === 'boolean') {
              initialEditing = meta.isEditingPassword;
            }
          } else {
            localStorage.removeItem(draftStorageKey);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load fanmark settings draft:', error);
    }

    if (!fanmark.is_password_protected && nextFormData.isPasswordProtected) {
      initialEditing = true;
    }

    reset(nextFormData);
    setIsEditingPassword(initialEditing);
    setHydratedDraftKey(draftStorageKey);
  }, [fanmark, draftStorageKey, reset, restoreEditingState, hydratedDraftKey, t]);

  // Persist draft as the user edits
  useEffect(() => {
    if (!draftStorageKey) return;
    const subscription = watch((values) => {
      try {
        const { accessPassword, ...rest } = values;
        localStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            timestamp: Date.now(),
            form: rest,
            meta: { isEditingPassword },
          })
        );
      } catch (error) {
        console.warn('Failed to persist fanmark settings draft:', error);
      }
    });

    return () => subscription.unsubscribe();
  }, [watch, draftStorageKey, isEditingPassword]);

  useEffect(() => {
    if (!isPasswordProtected) {
      setIsEditingPassword(false);
    }
  }, [isPasswordProtected]);

  const handleClose = () => {
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
      // Update fanmark basic config (fanmark name and access type)
      const { error: basicConfigError } = await supabase
        .from('fanmark_basic_configs')
        .upsert({
          license_id: fanmark.license_id,
          fanmark_name: data.fanmarkName,
          access_type: data.accessType
        }, {
          onConflict: 'license_id'
        });

      if (basicConfigError) throw basicConfigError;

      // Update specific config tables based on access type
      if (data.accessType === 'redirect' && data.targetUrl) {
        const { error: redirectError } = await supabase
          .from('fanmark_redirect_configs')
          .upsert({
            license_id: fanmark.license_id,
            target_url: data.targetUrl
          }, {
            onConflict: 'license_id'
          });
        if (redirectError) throw redirectError;
      }

      if (data.accessType === 'text') {
        const { error: textError } = await supabase
          .from('fanmark_messageboard_configs')
          .upsert({
            license_id: fanmark.license_id,
            content: data.textContent || ''
          }, {
            onConflict: 'license_id'
          });
        if (textError) throw textError;
      }

      // Handle password protection for all access types except inactive
      if (data.accessType !== 'inactive') {
        if (data.isPasswordProtected && data.accessPassword) {
          // Enable password protection using secure function
          const { error: passwordError } = await supabase.rpc('upsert_fanmark_password_config', {
            license_uuid: fanmark.license_id,
            new_password: data.accessPassword,
            enable_password: true
          });
          
          if (passwordError) throw passwordError;
        } else {
          // Disable password protection using secure function
          const { error: passwordError } = await supabase.rpc('upsert_fanmark_password_config', {
            license_uuid: fanmark.license_id,
            new_password: data.accessPassword || '0000', // Default password when disabling
            enable_password: false
          });
          
          if (passwordError) throw passwordError;
        }
      } else {
        // For inactive access type, disable password protection entirely
        const { error: passwordError } = await supabase.rpc('upsert_fanmark_password_config', {
          license_uuid: fanmark.license_id,
          new_password: '0000', // Default password when disabling
          enable_password: false
        });
        
        if (passwordError) {
          // If function fails, it might be because no password config exists yet, which is fine
          console.log('No existing password config to disable');
        }
      }

      // Create fanmark profile if requested
      if (data.createProfile && data.accessType === 'profile') {
        const { error: profileError } = await supabase
          .from('fanmark_profiles')
          .upsert({
            license_id: fanmark.license_id,
            bio: `Profile for ${fanmark.fanmark || fanmark.user_input_fanmark}`,
            is_public: data.is_public,
          }, {
            onConflict: 'license_id'
          });

        if (profileError) {
          console.error('Profile creation error:', profileError);
          // Don't fail the whole operation if profile creation fails
        }
      }

      // Update existing profile's public setting if profile type is selected
      if (data.accessType === 'profile') {
        const { error: profileUpdateError } = await supabase
          .from('fanmark_profiles')
          .update({ is_public: data.is_public })
          .eq('license_id', fanmark.license_id);

        if (profileUpdateError) {
          console.error('Profile update error:', profileUpdateError);
          // Don't fail the whole operation if profile update fails
        }
      }

      if (draftStorageKey) {
        localStorage.removeItem(draftStorageKey);
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

  // Watch fanmark name for real-time updates
  const watchedFanmarkName = watch('fanmarkName');
  const watchedTextContent = watch('textContent');
  const watchedAccessType = watch('accessType');
  const displayLabel = watchedFanmarkName || fanmark?.fanmark_name || t('fanmarkSettings.summary.defaultName');


  // Don't render if fanmark is null
  if (!fanmark) {
    return null;
  }

  const summaryCard = (
    <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/10 px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{fanmark.fanmark || fanmark.user_input_fanmark}</span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">{displayLabel}</span>
          <span className="text-xs text-muted-foreground">{fanmark.short_id}</span>
        </div>
      </div>
    </div>
  );

  const formContent = (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 pt-4">
      {summaryCard}

      {/* Fanmark Name */}
      <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur">
        <CardContent className="p-6 space-y-4">
          <Label htmlFor="fanmarkName" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FiType className="h-4 w-4" />
            </div>
            {t('fanmarkSettings.fields.displayName.label')}
          </Label>
          <p className="text-xs text-muted-foreground">{t('fanmarkSettings.fields.displayName.helper')}</p>
          <Input
            id="fanmarkName"
            {...register('fanmarkName')}
            placeholder={t('fanmarkSettings.fields.displayName.placeholder')}
            className="h-12 rounded-xl border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          />
          {errors.fanmarkName && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <FiAlertCircle className="h-4 w-4" />
              {errors.fanmarkName.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Access Type & Related Settings */}
      <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur">
        <CardContent className="p-6 space-y-6">
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                <FiSettings className="h-4 w-4" />
              </div>
              {t('fanmarkSettings.fields.accessType.label')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('fanmarkSettings.fields.accessType.helper')}</p>
            <Controller
              name="accessType"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} defaultValue={field.value}>
                  <SelectTrigger ref={field.ref} className="h-12 rounded-xl border border-border bg-background/80 px-5 text-left text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
                    <SelectValue placeholder={t('fanmarkSettings.fields.accessType.placeholder')} />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border border-border/60 bg-card/95 shadow-2xl shadow-primary/10">
                    <SelectGroup>
                      {accessTypes.map((option) => {
                        const Icon = option.icon;
                        return (
                          <SelectItem key={option.value} value={option.value} className="py-3 pl-9 pr-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
                                <Icon className="h-4 w-4" />
                              </div>
                              <span className="text-sm font-semibold text-foreground">{t(option.labelKey)}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.accessType && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <FiAlertCircle className="h-4 w-4" />
                {errors.accessType.message ?? t('fanmarkSettings.validation.accessTypeRequired')}
              </p>
            )}
          </div>

          {/* Password Protection - Common setting for all access types except inactive */}
          {accessType !== 'inactive' && (
            <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
              <Label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <FiLock className="h-3.5 w-3.5" />
                {t('fanmarkSettings.fields.passwordProtection.label')}
              </Label>
              <div className="space-y-3 pl-6">
                <div className="flex items-center space-x-2">
                  <Controller
                    name="isPasswordProtected"
                    control={control}
                    render={({ field }) => (
                      <Checkbox
                        id="password-protection"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <Label htmlFor="password-protection" className="text-sm font-medium">
                    {t('fanmarkSettings.fields.passwordProtection.lockCheckbox')}
                  </Label>
                </div>
                
                {isPasswordProtected && (
                  <div className="space-y-2">
                    <Label htmlFor="accessPassword" className="text-xs text-muted-foreground">
                      {t('fanmarkSettings.fields.passwordProtection.passwordHelper')}
                    </Label>
                    
                    {/* Password input states */}
                    {(!fanmark?.is_password_protected || isEditingPassword) ? (
                      // State 1: Not set OR State 3: Editing
                      <Input
                        id="accessPassword"
                        {...register('accessPassword')}
                        placeholder={t('fanmarkSettings.fields.passwordProtection.passwordPlaceholder')}
                        maxLength={4}
                        pattern="[0-9]*"
                        className="h-10 w-24 rounded-lg border border-border text-center font-mono text-lg focus-visible:ring-2 focus-visible:ring-primary"
                        onInput={(e) => {
                          // Only allow numbers
                          const target = e.target as HTMLInputElement;
                          target.value = target.value.replace(/[^0-9]/g, '');
                        }}
                      />
                    ) : (
                      // State 2: Set (show label + change button)
                      <div className="flex items-center gap-2 h-10">
                        <div className="w-24 h-10 px-3 py-2 rounded-lg border border-border bg-muted/50 flex items-center justify-center text-sm text-muted-foreground">
                          {t('fanmarkSettings.fields.passwordProtection.passwordSet')}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsEditingPassword(true)}
                          className="h-10 px-3"
                        >
                          {t('fanmarkSettings.fields.passwordProtection.changeButton')}
                        </Button>
                      </div>
                    )}
                    
                    {/* Cancel button when editing existing password */}
                    {fanmark?.is_password_protected && isEditingPassword && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsEditingPassword(false);
                          setValue('accessPassword', '');
                        }}
                        className="h-8 px-2 text-xs"
                      >
                        {t('common.cancel')}
                      </Button>
                    )}
                    
                    {errors.accessPassword && (
                      <p className="text-xs text-destructive">
                        {t('fanmarkSettings.fields.passwordProtection.passwordHelper')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Access Type Specific Settings */}
          {(accessType === 'redirect' || accessType === 'text' || accessType === 'profile') && (
            <div className="space-y-4 rounded-xl border border-border/60 bg-background/70 p-4">
              {accessType === 'redirect' && (
                <div className="space-y-2">
                  <Label htmlFor="targetUrl" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <FiExternalLink className="h-3.5 w-3.5" />
                    {t('fanmarkSettings.fields.redirect.label')}
                  </Label>
                  <Input
                    id="targetUrl"
                    {...register('targetUrl')}
                    placeholder="https://example.com"
                    type="url"
                    className="h-11 rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                  />
                  {errors.targetUrl && (
                    <p className="flex items-center gap-2 text-sm text-destructive">
                      <FiAlertCircle className="h-4 w-4" />
                      {errors.targetUrl.message}
                    </p>
                  )}
                </div>
              )}

              {accessType === 'text' && (
                <div className="space-y-3">
                  <Label htmlFor="textContent" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <FiEdit3 className="h-3.5 w-3.5" />
                    {t('fanmarkSettings.fields.text.label')}
                  </Label>
                  <Textarea
                    id="textContent"
                    {...register('textContent')}
                    placeholder={t('fanmarkSettings.fields.text.placeholder')}
                    rows={4}
                    className="rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                  />
                  {errors.textContent && (
                    <p className="flex items-center gap-2 text-sm text-destructive">
                      <FiAlertCircle className="h-4 w-4" />
                      {errors.textContent.message}
                    </p>
                  )}
                  <div className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (fanmark?.id) {
                          // 現在の入力状態をプレビューに渡す
                          navigate(`/fanmarks/${fanmark.id}/messageboard/preview`, {
                            state: {
                              previewContent: watchedTextContent || '',
                              editingState: {
                                accessType: watchedAccessType,
                                fanmarkName: watchedFanmarkName,
                                textContent: watchedTextContent,
                                isPasswordProtected: watch('isPasswordProtected'),
                                accessPassword: watch('accessPassword'),
                                is_public: watch('is_public')
                              }
                            }
                          });
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-full border-border/60 text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                      プレビュー
                    </Button>
                  </div>
                </div>
              )}

              {accessType === 'profile' && (
                <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
                  <Label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <FiImage className="h-3.5 w-3.5" />
                    {t('fanmarkSettings.fields.profile.label')}
                  </Label>
                  <div className="space-y-3 pl-6">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (fanmark?.id) {
                            navigate(`/fanmarks/${fanmark.id}/profile/edit`);
                          }
                        }}
                        className="inline-flex items-center gap-2 rounded-full border-border/60 text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors"
                      >
                        <Edit className="h-4 w-4" />
                        {t('fanmarkSettings.actions.editProfile')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (fanmark?.id) {
                            navigate(`/fanmarks/${fanmark.id}/profile/preview`, {
                              state: { from: 'settings' }
                            });
                          }
                        }}
                        className="inline-flex items-center gap-2 rounded-full border-border/60 text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                        {t('emojiProfile.preview')}
                      </Button>
                    </div>

                    {/* Profile Privacy Settings */}
                    <div className="flex items-start space-x-4 p-4 rounded-xl bg-primary/5 border border-primary/10">
                      <Controller
                        name="is_public"
                        control={control}
                        render={({ field }) => (
                          <Checkbox
                            id="is_public"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="mt-1"
                          />
                        )}
                      />
                      <div className="space-y-2">
                        <Label htmlFor="is_public" className="text-sm font-medium cursor-pointer">
                          プロフィールを公開する
                        </Label>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          公開すると、他のユーザーがあなたのプロフィールを閲覧できるようになります
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>


      {/* Action Buttons */}
      <div className="flex flex-col-reverse gap-3 pt-6 border-t border-border/20 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={handleClose}
          disabled={isSubmitting}
          className="h-12 w-full rounded-full border border-border bg-transparent px-6 text-base font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30 sm:w-auto"
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-12 w-full rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground shadow-[0_12px_30px_rgba(101,195,200,0.18)] transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:opacity-60 sm:w-48"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('common.saving')}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <FiSave className="h-5 w-5" />
              {t('fanmarkSettings.actions.save')}
            </div>
          )}
        </Button>
      </div>
    </form>
  );

  if (mode === 'page') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <FiSettings className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('fanmarkSettings.title')}</h1>
          </div>
          {formContent}
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(value) => onOpenChange?.(value)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-primary/15 bg-background/95 backdrop-blur-xl shadow-[0_30px_60px_rgba(101,195,200,0.18)]">
        <DialogHeader className="space-y-4 pb-6 border-b border-border/15">
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <FiSettings className="h-7 w-7" />
            </div>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">
              {t('fanmarkSettings.title')}
            </DialogTitle>
          </div>
        </DialogHeader>
        {formContent}
      </DialogContent>
    </Dialog>
  );
};
