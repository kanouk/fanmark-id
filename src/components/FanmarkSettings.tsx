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
import { Loader2 } from 'lucide-react';
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
  FiImage
} from 'react-icons/fi';

type AccessType = 'profile' | 'redirect' | 'text' | 'inactive';

const settingsSchema = z.object({
  accessType: z.enum(['profile', 'redirect', 'text', 'inactive']),
  displayName: z.string().min(1, 'Display name is required'),
  targetUrl: z.string().url().optional().or(z.literal('')),
  textContent: z.string().optional(),
  createProfile: z.boolean().default(false),
}).refine((data) => {
  if (data.accessType === 'redirect' && !data.targetUrl) {
    return false;
  }
  if (data.accessType === 'text' && !data.textContent) {
    return false;
  }
  return true;
}, {
  message: 'Please fill in required fields for selected access type',
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export interface Fanmark {
  id: string;
  emoji_combination: string;
  display_name: string | null;
  access_type: AccessType;
  target_url?: string;
  text_content?: string;
  
  status: string;
  short_id: string;
}

interface FanmarkSettingsProps {
  fanmark: Fanmark | null;
  mode?: 'dialog' | 'page';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  onSuccess?: () => void;
}

export const FanmarkSettings = ({
  fanmark,
  mode = 'dialog',
  open = false,
  onOpenChange,
  onClose,
  onSuccess,
}: FanmarkSettingsProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
  });

  const accessType = watch('accessType');

  // Reset form when fanmark changes
  useEffect(() => {
    if (fanmark) {
      reset({
        accessType: fanmark.access_type,
        displayName: fanmark.display_name,
        targetUrl: fanmark.target_url || '',
        textContent: fanmark.text_content || '',
        createProfile: false, // This is a one-time action
      });
    }
  }, [fanmark, reset]);

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
      const { error } = await supabase
        .from('fanmarks')
        .update({
          access_type: data.accessType,
          display_name: data.displayName,
          target_url: data.targetUrl || null,
          text_content: data.textContent || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', fanmark.id);

      if (error) throw error;

      // Create emoji profile if requested
      if (data.createProfile && data.accessType === 'profile') {
        const { error: profileError } = await supabase
          .from('emoji_profiles')
          .upsert({
            fanmark_id: fanmark.id,
            user_id: (await supabase.auth.getUser()).data.user?.id,
            bio: `Profile for ${fanmark.emoji_combination}`,
            is_public: true,
          });

        if (profileError) {
          console.error('Profile creation error:', profileError);
          // Don't fail the whole operation if profile creation fails
        }
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
      toast({
        title: t('fanmarkSettings.toast.errorTitle'),
        description: error instanceof Error ? error.message : t('fanmarkSettings.toast.errorDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const accessTypes = [
    {
      value: 'profile',
      labelKey: 'fanmarkSettings.accessTypeOptions.profile',
      icon: FiUser,
    },
    {
      value: 'redirect',
      labelKey: 'fanmarkSettings.accessTypeOptions.redirect',
      icon: FiExternalLink,
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

  const displayLabel = fanmark?.display_name ?? t('fanmarkSettings.summary.defaultName');


  // Don't render if fanmark is null
  if (!fanmark) {
    return null;
  }

  const summaryCard = (
    <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/10 px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{fanmark.emoji_combination}</span>
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

      {/* Display Name */}
      <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur">
        <CardContent className="p-6 space-y-4">
          <Label htmlFor="displayName" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FiType className="h-4 w-4" />
            </div>
            {t('fanmarkSettings.fields.displayName.label')} <span className="ml-1 text-xs text-destructive">*</span>
          </Label>
          <p className="text-xs text-muted-foreground">{t('fanmarkSettings.fields.displayName.helper')}</p>
          <Input
            id="displayName"
            {...register('displayName')}
            placeholder={t('fanmarkSettings.fields.displayName.placeholder')}
            className="h-12 rounded-xl border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          />
          {errors.displayName && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <FiAlertCircle className="h-4 w-4" />
              {errors.displayName.message}
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
              {t('fanmarkSettings.fields.accessType.label')} <span className="ml-1 text-xs text-destructive">*</span>
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
                <div className="space-y-2">
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
                </div>
              )}

              {accessType === 'profile' && (
                <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
                  <Label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <FiImage className="h-3.5 w-3.5" />
                    {t('fanmarkSettings.fields.profile.label')}
                  </Label>
                  <div className="space-y-3 pl-6">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        id="createProfile"
                        {...register('createProfile')}
                        className="h-5 w-5 rounded border-border text-primary focus:ring-primary"
                      />
                      {t('fanmarkSettings.fields.profile.publish')}
                    </label>
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
                      {t('fanmarkSettings.actions.editProfile')}
                    </Button>
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
