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
import { User, Link, FileText, Moon, Loader2 } from 'lucide-react';

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
  fanmark: Fanmark;
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
    reset({
      accessType: fanmark.access_type as any,
      displayName: fanmark.display_name,
      targetUrl: fanmark.target_url || '',
      textContent: fanmark.text_content || '',
      createProfile: false, // This is a one-time action
      isTransferable: fanmark.is_transferable,
    });
  }, [fanmark, reset]);

  const onSubmit = async (data: SettingsFormData) => {
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
        description: 'ファンマークの設定が正常に保存されました',
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
      icon: User,
      gradient: 'from-blue-400 to-cyan-400'
    },
    { 
      value: 'redirect', 
      label: 'URL リダイレクト', 
      desc: '指定したURLにリダイレクトします',
      icon: Link,
      gradient: 'from-purple-400 to-pink-400'
    },
    { 
      value: 'text', 
      label: 'テキスト表示', 
      desc: 'カスタムテキストを表示します',
      icon: FileText,
      gradient: 'from-green-400 to-emerald-400'
    },
    { 
      value: 'inactive', 
      label: '未設定', 
      desc: '後で設定します',
      icon: Moon,
      gradient: 'from-gray-400 to-slate-400'
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-base-100 to-base-200">
        <DialogHeader className="space-y-4">
          <DialogTitle className="text-3xl font-bold flex items-center gap-3 text-center justify-center">
            <span className="text-5xl animate-bounce">{fanmark.emoji_combination}</span>
            <div>
              <div className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                ファンマーク設定
              </div>
              <div className="text-sm font-normal text-base-content/70">
                あなたのファンマークをカスタマイズ
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* Display Name */}
          <Card className="overflow-hidden">
            <CardContent className="p-6">
              <div className="space-y-3">
                <Label htmlFor="displayName" className="text-lg font-semibold flex items-center gap-2">
                  <span className="text-2xl">✨</span>
                  表示名
                </Label>
                <Input
                  id="displayName"
                  {...register('displayName')}
                  placeholder="表示名を入力してください"
                  className="text-lg h-12 border-2 focus:border-primary transition-all duration-300"
                />
                {errors.displayName && (
                  <p className="text-sm text-error flex items-center gap-2">
                    <span>⚠️</span>
                    {errors.displayName.message}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Access Type */}
          <Card className="overflow-hidden">
            <CardContent className="p-6">
              <div className="space-y-4">
                <Label className="text-lg font-semibold flex items-center gap-2">
                  <span className="text-2xl">🎮</span>
                  アクセスタイプ
                </Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {accessTypes.map((option) => {
                    const Icon = option.icon;
                    const isSelected = accessType === option.value;
                    
                    return (
                      <label
                        key={option.value}
                        className={`relative group cursor-pointer block transition-all duration-300 hover:scale-105 ${
                          isSelected ? 'scale-105 shadow-lg' : ''
                        }`}
                      >
                        <Card className={`overflow-hidden border-2 transition-all duration-300 ${
                          isSelected 
                            ? 'border-primary shadow-primary/25 shadow-lg' 
                            : 'border-base-300 hover:border-primary/50'
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
                                className="radio radio-primary mt-1"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Icon className={`h-5 w-5 transition-colors duration-300 ${
                                    isSelected ? 'text-primary' : 'text-base-content/60'
                                  }`} />
                                  <div className={`font-semibold transition-colors duration-300 ${
                                    isSelected ? 'text-primary' : 'text-base-content'
                                  }`}>
                                    {option.label}
                                  </div>
                                </div>
                                <div className="text-sm text-base-content/70">
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
            <Card className="overflow-hidden animate-fade-in">
              <CardContent className="p-6">
                <div className="space-y-3">
                  <Label htmlFor="targetUrl" className="text-lg font-semibold flex items-center gap-2">
                    <span className="text-2xl">🔗</span>
                    リダイレクト先URL
                  </Label>
                  <Input
                    id="targetUrl"
                    {...register('targetUrl')}
                    placeholder="https://example.com"
                    type="url"
                    className="text-lg h-12 border-2 focus:border-primary transition-all duration-300"
                  />
                  {errors.targetUrl && (
                    <p className="text-sm text-error flex items-center gap-2">
                      <span>⚠️</span>
                      {errors.targetUrl.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {accessType === 'text' && (
            <Card className="overflow-hidden animate-fade-in">
              <CardContent className="p-6">
                <div className="space-y-3">
                  <Label htmlFor="textContent" className="text-lg font-semibold flex items-center gap-2">
                    <span className="text-2xl">📝</span>
                    表示テキスト
                  </Label>
                  <Textarea
                    id="textContent"
                    {...register('textContent')}
                    placeholder="表示するテキストを入力してください"
                    rows={4}
                    className="text-lg border-2 focus:border-primary transition-all duration-300 resize-none"
                  />
                  {errors.textContent && (
                    <p className="text-sm text-error flex items-center gap-2">
                      <span>⚠️</span>
                      {errors.textContent.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Additional Options */}
          <Card className="overflow-hidden">
            <CardContent className="p-6 space-y-6">
              {accessType === 'profile' && (
                <div className="flex items-center gap-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <input
                    type="checkbox"
                    id="createProfile"
                    {...register('createProfile')}
                    className="checkbox checkbox-primary"
                  />
                  <Label htmlFor="createProfile" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">🎨</span>
                      <span className="font-semibold">プロフィールページを作成</span>
                    </div>
                    <div className="text-sm text-base-content/70">
                      基本的なプロフィールを自動生成します
                    </div>
                  </Label>
                </div>
              )}

              <div className="flex items-center gap-4 p-4 bg-secondary/5 rounded-lg border border-secondary/20">
                <input
                  type="checkbox"
                  id="isTransferable"
                  {...register('isTransferable')}
                  className="toggle toggle-secondary"
                />
                <Label htmlFor="isTransferable" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">🔄</span>
                    <span className="font-semibold">譲渡を許可する</span>
                  </div>
                  <div className="text-sm text-base-content/70">
                    他のユーザーにファンマークを譲渡できます
                  </div>
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 h-14 text-lg font-semibold bg-gradient-to-r from-primary to-secondary hover:from-primary-focus hover:to-secondary-focus disabled:opacity-50 transition-all duration-300"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  保存中...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xl">💾</span>
                  設定を保存
                </div>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="px-8 h-14 text-lg font-semibold border-2 hover:border-primary hover:text-primary transition-all duration-300"
            >
              キャンセル
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};