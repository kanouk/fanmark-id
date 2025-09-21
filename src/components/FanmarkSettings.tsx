import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <span className="text-3xl">{fanmark.emoji_combination}</span>
            ファンマーク設定
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName" className="text-lg">
              ✨ 表示名
            </Label>
            <Input
              id="displayName"
              {...register('displayName')}
              placeholder="表示名を入力"
              className="border-2 border-dotted border-pink-300"
            />
            {errors.displayName && (
              <p className="text-sm text-red-500">{errors.displayName.message}</p>
            )}
          </div>

          {/* Access Type */}
          <div className="space-y-3">
            <Label className="text-lg">🎮 アクセスタイプ</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { value: 'profile', label: '📄 プロフィールページ', desc: '個人ページを作成' },
                { value: 'redirect', label: '🔗 URL リダイレクト', desc: 'URLにリダイレクト' },
                { value: 'text', label: '📝 テキスト表示', desc: 'カスタムテキスト表示' },
                { value: 'inactive', label: '😴 未設定', desc: '後で設定する' },
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

          {/* Target URL (for redirect) */}
          {accessType === 'redirect' && (
            <div className="space-y-2">
              <Label htmlFor="targetUrl" className="text-lg">
                🔗 リダイレクト先URL
              </Label>
              <Input
                id="targetUrl"
                {...register('targetUrl')}
                placeholder="https://example.com"
                type="url"
              />
              {errors.targetUrl && (
                <p className="text-sm text-red-500">{errors.targetUrl.message}</p>
              )}
            </div>
          )}

          {/* Text Content (for text display) */}
          {accessType === 'text' && (
            <div className="space-y-2">
              <Label htmlFor="textContent" className="text-lg">
                📝 表示テキスト
              </Label>
              <Textarea
                id="textContent"
                {...register('textContent')}
                placeholder="表示するテキストを入力"
                rows={4}
              />
              {errors.textContent && (
                <p className="text-sm text-red-500">{errors.textContent.message}</p>
              )}
            </div>
          )}

          {/* Create Profile Option */}
          {accessType === 'profile' && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="createProfile"
                {...register('createProfile')}
                className="checkbox checkbox-primary"
              />
              <Label htmlFor="createProfile" className="text-lg">
                🎨 プロフィールページを作成（基本的なプロフィールを自動生成）
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
              🔄 譲渡を許可する
            </Label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-gradient-to-r from-blue-400 to-purple-400 hover:from-blue-500 hover:to-purple-500"
            >
              {isSubmitting ? (
                <>
                  <span className="loading loading-spinner loading-sm mr-2"></span>
                  保存中...
                </>
              ) : (
                '💾 設定を保存'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              キャンセル
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};