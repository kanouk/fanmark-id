import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
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
  isTransferable: z.boolean().default(true),
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

interface Fanmark {
  id: string;
  emoji_combination: string;
  display_name: string;
  access_type: AccessType;
  target_url?: string;
  text_content?: string;
  is_transferable: boolean;
  status: string;
}

interface FanmarkSettingsProps {
  fanmark: Fanmark | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const FanmarkSettings = ({ 
  fanmark, 
  open, 
  onOpenChange, 
  onSuccess 
}: FanmarkSettingsProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        isTransferable: fanmark.is_transferable,
      });
    }
  }, [fanmark, reset]);

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
          is_transferable: data.isTransferable,
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
        title: '設定を更新しました ✨',
        description: 'ファンマの設定が正常に保存されました',
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Settings update error:', error);
      toast({
        title: '更新に失敗しました',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const accessTypes = [
    {
      value: 'profile',
      label: 'プロフィールページ',
      desc: 'ファンとつながる専用プロフィールを表示します',
      icon: FiUser,
    },
    {
      value: 'redirect',
      label: 'URL リダイレクト',
      desc: '指定先のURLへスムーズに案内します',
      icon: FiExternalLink,
    },
    {
      value: 'text',
      label: 'テキスト表示',
      desc: '短いメッセージやお知らせを表示します',
      icon: FiFileText,
    },
    {
      value: 'inactive',
      label: '未設定',
      desc: 'まだ公開しない場合はこちら',
      icon: FiMoon,
    },
  ];

  const selectedAccessType = accessTypes.find((option) => option.value === accessType);
  const SelectedAccessIcon = selectedAccessType?.icon ?? FiSettings;

  // Don't render if fanmark is null
  if (!fanmark) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-primary/15 bg-background/95 backdrop-blur-xl shadow-[0_30px_60px_rgba(101,195,200,0.18)]">
        <DialogHeader className="space-y-6 pb-6 border-b border-border/15">
          <DialogTitle className="flex items-center justify-center gap-4 text-center text-3xl font-semibold tracking-tight">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 via-secondary/15 to-primary/10 border border-primary/20">
              <FiSettings className="w-8 h-8 text-primary" />
            </div>
            <div>
              <div className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                ファンマ設定
              </div>
              <div className="text-sm font-normal text-muted-foreground mt-1">
                {fanmark.emoji_combination} のカスタマイズ
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 pt-4">
          {/* Display Name */}
          <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-lg shadow-primary/5 backdrop-blur hover:shadow-xl hover:shadow-primary/10 transition-all duration-300">
            <CardContent className="p-6">
              <div className="space-y-4">
                <Label htmlFor="displayName" className="text-lg font-semibold flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">
                    <FiType className="w-4 h-4" />
                  </div>
                  表示名
                </Label>
                <Input
                  id="displayName"
                  {...register('displayName')}
                  placeholder="表示名を入力してください"
                  className="text-lg h-12 border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:border-transparent transition-all duration-300"
                />
                {errors.displayName && (
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <FiAlertCircle className="w-4 h-4" />
                    {errors.displayName.message}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Access Type */}
          <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-lg shadow-primary/5 backdrop-blur hover:shadow-xl hover:shadow-primary/10 transition-all duration-300">
            <CardContent className="p-6">
              <div className="space-y-5">
                <Label className="text-lg font-semibold flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary/10 text-secondary">
                    <FiSettings className="w-4 h-4" />
                  </div>
                  アクセスタイプ
                </Label>
                <div className="space-y-4">
                  <Controller
                    name="accessType"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger ref={field.ref} className="h-12 rounded-xl border border-border bg-background/80 px-4 text-left text-base font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
                          <SelectValue placeholder="アクセスタイプを選択" />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl border border-border/60 bg-card/95 shadow-2xl shadow-primary/10">
                          <SelectGroup>
                            <SelectLabel className="px-4 pt-2 pb-1 text-xs tracking-[0.3em] text-muted-foreground uppercase">
                              Access Options
                            </SelectLabel>
                            {accessTypes.map((option) => {
                              const Icon = option.icon;
                              return (
                                <SelectItem key={option.value} value={option.value} className="py-3 pl-8 pr-3">
                                  <div className="flex items-start gap-3">
                                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                      <Icon className="h-4 w-4" />
                                    </div>
                                    <div className="flex flex-col gap-1 text-left">
                                      <span className="text-sm font-semibold text-foreground">{option.label}</span>
                                      <span className="text-xs text-muted-foreground leading-relaxed">{option.desc}</span>
                                    </div>
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
                      <FiAlertCircle className="w-4 h-4" />
                      {errors.accessType.message ?? 'アクセスタイプを選択してください'}
                    </p>
                  )}
                  {selectedAccessType && (
                    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-relaxed text-muted-foreground">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                        <SelectedAccessIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-base font-semibold text-foreground">{selectedAccessType.label}</div>
                        <div>{selectedAccessType.desc}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Conditional Fields */}
          {accessType === 'redirect' && (
            <Card className="overflow-hidden animate-fade-in rounded-2xl border border-border/50 bg-card/80 shadow-lg shadow-primary/5 backdrop-blur">
              <CardContent className="p-6">
                <div className="space-y-4">
                  <Label htmlFor="targetUrl" className="text-lg font-semibold flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600">
                      <FiExternalLink className="w-4 h-4" />
                    </div>
                    リダイレクト先URL
                  </Label>
                  <Input
                    id="targetUrl"
                    {...register('targetUrl')}
                    placeholder="https://example.com"
                    type="url"
                    className="text-lg h-12 border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:border-transparent transition-all duration-300"
                  />
                  {errors.targetUrl && (
                    <p className="text-sm text-destructive flex items-center gap-2">
                      <FiAlertCircle className="w-4 h-4" />
                      {errors.targetUrl.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {accessType === 'text' && (
            <Card className="overflow-hidden animate-fade-in rounded-2xl border border-border/50 bg-card/80 shadow-lg shadow-primary/5 backdrop-blur">
              <CardContent className="p-6">
                <div className="space-y-4">
                  <Label htmlFor="textContent" className="text-lg font-semibold flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-500/10 text-green-600">
                      <FiEdit3 className="w-4 h-4" />
                    </div>
                    表示テキスト
                  </Label>
                  <Textarea
                    id="textContent"
                    {...register('textContent')}
                    placeholder="表示するテキストを入力してください"
                    rows={4}
                    className="text-lg border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:border-transparent transition-all duration-300 resize-none"
                  />
                  {errors.textContent && (
                    <p className="text-sm text-destructive flex items-center gap-2">
                      <FiAlertCircle className="w-4 h-4" />
                      {errors.textContent.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Additional Options */}
          <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-lg shadow-primary/5 backdrop-blur">
            <CardContent className="p-6 space-y-6">
              {accessType === 'profile' && (
                <div className="flex items-start gap-4 p-5 bg-gradient-to-r from-primary/5 to-secondary/5 rounded-xl border border-primary/20 hover:bg-gradient-to-r hover:from-primary/10 hover:to-secondary/10 transition-all duration-300">
                  <input
                    type="checkbox"
                    id="createProfile"
                    {...register('createProfile')}
                    className="w-5 h-5 text-primary border-border focus:ring-primary focus:ring-2 rounded mt-0.5"
                  />
                  <Label htmlFor="createProfile" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 text-primary">
                        <FiImage className="w-3 h-3" />
                      </div>
                      <span className="font-semibold text-foreground">プロフィールページを作成</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      基本的なプロフィールを自動生成します
                    </div>
                  </Label>
                </div>
              )}

              <div className="flex items-start gap-4 p-5 bg-gradient-to-r from-secondary/5 to-accent/5 rounded-xl border border-secondary/20 hover:bg-gradient-to-r hover:from-secondary/10 hover:to-accent/10 transition-all duration-300">
                <input
                  type="checkbox"
                  id="isTransferable"
                  {...register('isTransferable')}
                  className="w-5 h-5 text-secondary border-border focus:ring-secondary focus:ring-2 rounded mt-0.5"
                />
                <Label htmlFor="isTransferable" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-secondary/10 text-secondary">
                      <FiRepeat className="w-3 h-3" />
                    </div>
                    <span className="font-semibold text-foreground">譲渡を許可する</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    他のユーザーにファンマを譲渡できます
                  </div>
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex flex-col-reverse gap-3 pt-6 border-t border-border/20 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="h-12 w-full rounded-full border border-border/70 bg-transparent px-6 text-base font-medium text-muted-foreground transition-colors duration-200 hover:border-primary/60 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30 sm:w-auto"
            >
              キャンセル
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-12 w-full rounded-full bg-gradient-to-r from-primary via-secondary to-primary px-6 text-base font-semibold text-primary-foreground shadow-[0_15px_35px_rgba(101,195,200,0.18)] transition-all duration-200 hover:brightness-[1.05] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:opacity-60 sm:w-48"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  保存中...
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <FiSave className="h-5 w-5" />
                  設定を保存
                </div>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
