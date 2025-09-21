import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  access_type: string;
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
    formState: { errors },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
  });

  const accessType = watch('accessType');

  // Reset form when fanmark changes
  useEffect(() => {
    if (fanmark) {
      reset({
        accessType: fanmark.access_type as any,
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
      desc: '個人ページを作成します',
      icon: FiUser,
      gradient: 'from-blue-400 to-cyan-400'
    },
    { 
      value: 'redirect', 
      label: 'URL リダイレクト', 
      desc: '指定したURLにリダイレクトします',
      icon: FiExternalLink,
      gradient: 'from-purple-400 to-pink-400'
    },
    { 
      value: 'text', 
      label: 'テキスト表示', 
      desc: 'カスタムテキストを表示します',
      icon: FiFileText,
      gradient: 'from-green-400 to-emerald-400'
    },
    { 
      value: 'inactive', 
      label: '未設定', 
      desc: '後で設定します',
      icon: FiMoon,
      gradient: 'from-gray-400 to-slate-400'
    },
  ];

  // Don't render if fanmark is null
  if (!fanmark) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-background via-secondary/5 to-primary/5 border border-border/50 backdrop-blur-sm">
        <DialogHeader className="space-y-6 pb-6 border-b border-border/20">
          <DialogTitle className="text-3xl font-bold flex items-center gap-4 text-center justify-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/30 animate-pulse">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {accessTypes.map((option) => {
                    const Icon = option.icon;
                    const isSelected = accessType === option.value;
                    
                    return (
                      <label
                        key={option.value}
                        className={`relative group cursor-pointer block transition-all duration-300 hover:scale-[1.02] ${
                          isSelected ? 'scale-[1.02]' : ''
                        }`}
                      >
                        <Card className={`overflow-hidden border transition-all duration-300 rounded-xl ${
                          isSelected 
                            ? 'border-primary bg-primary/5 shadow-lg shadow-primary/20 ring-2 ring-primary/20' 
                            : 'border-border hover:border-primary/50 hover:bg-primary/5'
                        }`}>
                          <CardContent className="p-4">
                            <div className={`absolute inset-0 bg-gradient-to-br ${option.gradient} opacity-0 transition-opacity duration-300 ${
                              isSelected ? 'opacity-10' : 'group-hover:opacity-5'
                            }`} />
                            
                            <div className="relative flex items-start gap-3">
                              <input
                                type="radio"
                                value={option.value}
                                {...register('accessType')}
                                className="w-4 h-4 text-primary border-border focus:ring-primary focus:ring-2 mt-1"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Icon className={`h-5 w-5 transition-colors duration-300 ${
                                    isSelected ? 'text-primary' : 'text-muted-foreground'
                                  }`} />
                                  <div className={`font-semibold transition-colors duration-300 ${
                                    isSelected ? 'text-primary' : 'text-foreground'
                                  }`}>
                                    {option.label}
                                  </div>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {option.desc}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </label>
                    );
                  })}
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
          <div className="flex gap-4 pt-6 border-t border-border/20">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 h-14 text-lg font-semibold bg-gradient-to-r from-primary via-secondary to-accent hover:from-primary/90 hover:via-secondary/90 hover:to-accent/90 disabled:opacity-50 transition-all duration-300 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  保存中...
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <FiSave className="h-5 w-5" />
                  設定を保存
                </div>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="px-8 h-14 text-lg font-semibold border border-border hover:border-primary hover:text-primary hover:bg-primary/5 transition-all duration-300 rounded-xl hover:scale-[1.02] active:scale-[0.98]"
            >
              キャンセル
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
