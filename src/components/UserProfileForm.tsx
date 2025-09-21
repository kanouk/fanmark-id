import { useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import { Save, User, Link as LinkIcon, Globe, Upload, Trash2, Loader2 } from 'lucide-react';
import { SiInstagram, SiX, SiTiktok, SiYoutube, SiLine, SiGithub } from 'react-icons/si';

interface UserProfileFormProps {
  profile: any;
  onUpdate: (data: any) => Promise<void>;
}

const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', icon: <SiInstagram className="h-4 w-4" />, placeholder: '@username' },
  { key: 'twitter', label: 'X', icon: <SiX className="h-4 w-4" />, placeholder: '@username' },
  { key: 'tiktok', label: 'TikTok', icon: <SiTiktok className="h-4 w-4" />, placeholder: '@username' },
  { key: 'youtube', label: 'YouTube', icon: <SiYoutube className="h-4 w-4" />, placeholder: '@channel' },
  { key: 'line', label: 'LINE', icon: <SiLine className="h-4 w-4" />, placeholder: 'LINE ID' },
  { key: 'github', label: 'GitHub', icon: <SiGithub className="h-4 w-4" />, placeholder: 'username' },
];

export const UserProfileForm = ({ profile, onUpdate }: UserProfileFormProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { uploadAvatar, deleteAvatar, uploading } = useAvatarUpload();
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    display_name: profile?.display_name || '',
    bio: profile?.bio || '',
    avatar_url: profile?.avatar_url || '',
    is_public_profile: profile?.is_public_profile ?? true,
    social_links: profile?.social_links || {}
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await onUpdate(formData);
      toast({
        title: '✨ ' + t('profile.updateSuccess'),
        description: t('profile.updateSuccessDescription'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('profile.updateError'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const updateSocialLink = (platform: string, url: string) => {
    setFormData(prev => ({
      ...prev,
      social_links: {
        ...prev.social_links,
        [platform]: url
      }
    }));
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const avatarUrl = await uploadAvatar(file);
      setFormData(prev => ({ ...prev, avatar_url: avatarUrl }));
      await onUpdate({ avatar_url: avatarUrl });
      toast({
        title: '✨ ' + t('profile.avatarUploadSuccess'),
        description: t('profile.avatarUploadDescription'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('profile.avatarUploadError'),
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
        title: '✨ ' + t('profile.avatarRemoveSuccess'),
        description: t('profile.avatarRemoveDescription'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('profile.avatarRemoveError'),
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
            <p className="font-medium text-foreground">{t('profile.avatarLabel')}</p>
            <p>{t('profile.avatarHint')}</p>
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
              {uploading ? t('common.loading') : t('profile.uploadAvatar')}
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
                {t('profile.removeAvatar')}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="display_name" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <User className="h-4 w-4" />
              {t('profile.displayName')}
            </Label>
            <Input
              id="display_name"
              value={formData.display_name}
              onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
              placeholder={t('profile.displayNamePlaceholder')}
              className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio" className="text-sm font-semibold text-muted-foreground">
              {t('profile.bio')}
            </Label>
            <Textarea
              id="bio"
              value={formData.bio}
              onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
              placeholder={t('profile.bioPlaceholder')}
              className="min-h-[120px] rounded-2xl border border-primary/15 bg-background/80 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-primary/40"
              maxLength={140}
            />
            <div className="flex justify-end text-xs text-muted-foreground">{formData.bio.length}/140</div>
          </div>

          <div className="rounded-3xl border border-primary/15 bg-background/80 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{t('profile.publicProfile')}</p>
                <p className="text-xs text-muted-foreground">{t('profile.publicProfileDescription')}</p>
              </div>
              <Switch
                checked={formData.is_public_profile}
                onCheckedChange={(checked) =>
                  setFormData(prev => ({ ...prev, is_public_profile: checked }))
                }
              />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <LinkIcon className="h-5 w-5 text-primary" />
          {t('profile.socialLinks')}
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          {SOCIAL_PLATFORMS.map((item) => (
            <div key={item.key} className="space-y-2">
              <Label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                {item.icon}
                {item.label}
              </Label>
              <Input
                value={formData.social_links[item.key as keyof typeof formData.social_links] || ''}
                onChange={(e) => updateSocialLink(item.key, e.target.value)}
                placeholder={item.placeholder}
                className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-sm focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>
          ))}
          <div className="space-y-2 md:col-span-2">
            <Label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Globe className="h-4 w-4" />
              {t('profile.website')}
            </Label>
            <Input
              type="url"
              value={formData.social_links.website || ''}
              onChange={(e) => updateSocialLink('website', e.target.value)}
              placeholder="https://yoursite.com"
              className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-sm focus-visible:ring-2 focus-visible:ring-primary/40"
            />
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
              {t('common.saving')}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {t('profile.saveChanges')}
            </>
          )}
        </Button>
      </div>
    </form>
  );
};
