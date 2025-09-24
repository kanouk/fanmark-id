import { useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import { Save, User, Upload, Trash2, Loader2 } from 'lucide-react';

interface UserSettings {
  display_name: string | null;
  username: string;
  avatar_url: string | null;
  plan_type: 'free' | 'creator';
  preferred_language: 'en' | 'ja';
}

type UpdateSettingsPayload = Partial<UserSettings>;

interface UserProfileFormProps {
  profile: UserSettings | null;
  onUpdate: (data: UpdateSettingsPayload) => Promise<void>;
}

export const UserProfileForm = ({ profile, onUpdate }: UserProfileFormProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { uploadAvatar, deleteAvatar, uploading } = useAvatarUpload();
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    display_name: profile?.display_name ?? '',
    username: profile?.username ?? '',
    avatar_url: profile?.avatar_url ?? '',
    plan_type: profile?.plan_type ?? 'free' as 'free' | 'creator',
    preferred_language: profile?.preferred_language ?? 'en' as 'en' | 'ja',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await onUpdate(formData);
      toast({
        title: '✨ ' + t('userSettings.updateSuccess'),
        description: t('userSettings.updateSuccessDescription'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('userSettings.updateError'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const avatarUrl = await uploadAvatar(file);
      setFormData(prev => ({ ...prev, avatar_url: avatarUrl }));
      await onUpdate({ avatar_url: avatarUrl });
      toast({
        title: '✨ ' + t('userSettings.avatarUploadSuccess'),
        description: t('userSettings.avatarUploadDescription'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('userSettings.avatarUploadError'),
        variant: 'destructive',
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAvatarDelete = async () => {
    try {
      if (formData.avatar_url) {
        await deleteAvatar(formData.avatar_url);
      }
      setFormData(prev => ({ ...prev, avatar_url: '' }));
      await onUpdate({ avatar_url: null });
      toast({
        title: '✨ ' + t('userSettings.avatarRemoveSuccess'),
        description: t('userSettings.avatarRemoveDescription'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('userSettings.avatarRemoveError'),
        variant: 'destructive',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarUpload}
        className="hidden"
      />

      <div className="grid gap-8 md:grid-cols-[auto,1fr]">
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-primary/15 bg-background/80 p-6 text-center">
          <div className="relative h-24 w-24 overflow-hidden rounded-full border border-primary/20 bg-primary/10">
            {formData.avatar_url ? (
              <img src={formData.avatar_url} alt="Avatar" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <User className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-primary" />
            )}
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('userSettings.avatar')}</p>
            <p>{t('userSettings.avatarHint')}</p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="w-full gap-2 rounded-full border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? t('userSettings.uploading') : t('userSettings.uploadAvatar')}
            </Button>
            {formData.avatar_url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAvatarDelete}
                className="w-full gap-2 rounded-full text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                {t('userSettings.removeAvatar')}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="display_name" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <User className="h-4 w-4" />
              {t('userSettings.displayName')}
            </Label>
            <Input
              id="display_name"
              value={formData.display_name}
              onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
              placeholder={t('userSettings.displayNamePlaceholder')}
              className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-semibold text-muted-foreground">
              {t('userSettings.username')}
            </Label>
            <Input
              id="username"
              value={formData.username}
              onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
              placeholder={t('userSettings.usernamePlaceholder')}
              className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan_type" className="text-sm font-semibold text-muted-foreground">
              {t('userSettings.planType')}
            </Label>
            <select
              id="plan_type"
              value={formData.plan_type}
              onChange={(e) => setFormData(prev => ({ ...prev, plan_type: e.target.value as 'free' | 'creator' }))}
              className="h-11 w-full rounded-2xl border border-primary/15 bg-background/80 px-3 text-base shadow-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="free">{t('userSettings.planTypeFree')}</option>
              <option value="creator">{t('userSettings.planTypeCreator')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="preferred_language" className="text-sm font-semibold text-muted-foreground">
              {t('userSettings.preferredLanguage')}
            </Label>
            <select
              id="preferred_language"
              value={formData.preferred_language}
              onChange={(e) => setFormData(prev => ({ ...prev, preferred_language: e.target.value as 'en' | 'ja' }))}
              className="h-11 w-full rounded-2xl border border-primary/15 bg-background/80 px-3 text-base shadow-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="en">{t('userSettings.languageEnglish')}</option>
              <option value="ja">{t('userSettings.languageJapanese')}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="pt-4">
        <Button
          type="submit"
          disabled={loading}
          className="w-full gap-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:shadow-xl"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('userSettings.saving')}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {t('userSettings.saveChanges')}
            </>
          )}
        </Button>
      </div>
    </form>
  );
};