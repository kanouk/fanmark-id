import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import { Save, User, Link as LinkIcon, Globe, Upload, Camera, Trash2 } from 'lucide-react';
import { SiInstagram, SiX, SiTiktok, SiYoutube, SiLine, SiGithub } from 'react-icons/si';

interface UserProfileFormProps {
  profile: any;
  onUpdate: (data: any) => Promise<void>;
}

export const UserProfileForm = ({ profile, onUpdate }: UserProfileFormProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { uploadAvatar, deleteAvatar, uploading } = useAvatarUpload();
  const [loading, setLoading] = useState(false);
  
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
        title: "✨ " + t('profile.updateSuccess'),
        description: t('profile.updateSuccessDescription'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('profile.updateError'),
        variant: "destructive",
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
        title: "✨ アバター画像をアップロードしました",
        description: "プロフィール画像が更新されました。",
      });
    } catch (error) {
      toast({
        title: "エラー",
        description: "画像のアップロードに失敗しました。",
        variant: "destructive",
      });
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
        title: "✨ アバター画像を削除しました",
        description: "プロフィール画像が削除されました。",
      });
    } catch (error) {
      toast({
        title: "エラー",
        description: "画像の削除に失敗しました。",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <div className="space-y-4">
        <div className="form-control">
          <Label htmlFor="display_name" className="label">
            <span className="label-text flex items-center space-x-2">
              <User className="w-4 h-4" />
              <span>{t('profile.displayName')}</span>
            </span>
          </Label>
          <Input
            id="display_name"
            value={formData.display_name}
            onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
            placeholder={t('profile.displayNamePlaceholder')}
            className="w-full"
          />
        </div>

        <div className="form-control">
          <Label htmlFor="bio" className="label">
            <span className="label-text">{t('profile.bio')}</span>
          </Label>
          <Textarea
            id="bio"
            value={formData.bio}
            onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
            placeholder={t('profile.bioPlaceholder')}
            className="textarea textarea-bordered w-full h-24"
            maxLength={140}
          />
          <div className="label">
            <span className="label-text-alt">{formData.bio.length}/140</span>
          </div>
        </div>

        <div className="form-control">
          <Label className="label">
            <span className="label-text flex items-center space-x-2">
              <Camera className="w-4 h-4" />
              <span>アバター画像</span>
            </span>
          </Label>
          <div className="space-y-3">
            {/* Avatar Preview */}
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                {formData.avatar_url ? (
                  <img src={formData.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-8 h-8 text-primary" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex space-x-2">
                  {/* File Upload */}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                    id="avatar-upload"
                  />
                  <Label htmlFor="avatar-upload" className="btn btn-outline btn-sm cursor-pointer flex-1">
                    <Upload className="w-4 h-4" />
                    {uploading ? '画像をアップロード中...' : '画像をアップロード'}
                  </Label>
                  {/* Delete Button */}
                  {formData.avatar_url && (
                    <Button 
                      type="button"
                      variant="outline" 
                      size="sm" 
                      onClick={handleAvatarDelete}
                      className="btn btn-outline btn-error btn-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Social Links */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center space-x-2">
          <LinkIcon className="w-5 h-5" />
          <span>{t('profile.socialLinks')}</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="form-control">
            <Label className="label">
              <span className="label-text flex items-center space-x-2">
                <SiInstagram className="w-4 h-4" />
                <span>Instagram</span>
              </span>
            </Label>
            <Input
              value={formData.social_links.instagram || ''}
              onChange={(e) => updateSocialLink('instagram', e.target.value)}
              placeholder="@username"
              className="input input-bordered w-full"
            />
          </div>

          <div className="form-control">
            <Label className="label">
              <span className="label-text flex items-center space-x-2">
                <SiX className="w-4 h-4" />
                <span>X</span>
              </span>
            </Label>
            <Input
              value={formData.social_links.twitter || ''}
              onChange={(e) => updateSocialLink('twitter', e.target.value)}
              placeholder="@username"
              className="input input-bordered w-full"
            />
          </div>

          <div className="form-control">
            <Label className="label">
              <span className="label-text flex items-center space-x-2">
                <SiTiktok className="w-4 h-4" />
                <span>TikTok</span>
              </span>
            </Label>
            <Input
              value={formData.social_links.tiktok || ''}
              onChange={(e) => updateSocialLink('tiktok', e.target.value)}
              placeholder="@username"
              className="input input-bordered w-full"
            />
          </div>

          <div className="form-control">
            <Label className="label">
              <span className="label-text flex items-center space-x-2">
                <SiYoutube className="w-4 h-4" />
                <span>YouTube</span>
              </span>
            </Label>
            <Input
              value={formData.social_links.youtube || ''}
              onChange={(e) => updateSocialLink('youtube', e.target.value)}
              placeholder="@channel"
              className="input input-bordered w-full"
            />
          </div>

          <div className="form-control">
            <Label className="label">
              <span className="label-text flex items-center space-x-2">
                <SiLine className="w-4 h-4" />
                <span>LINE</span>
              </span>
            </Label>
            <Input
              value={formData.social_links.line || ''}
              onChange={(e) => updateSocialLink('line', e.target.value)}
              placeholder="LINE ID"
              className="input input-bordered w-full"
            />
          </div>

          <div className="form-control">
            <Label className="label">
              <span className="label-text flex items-center space-x-2">
                <SiGithub className="w-4 h-4" />
                <span>GitHub</span>
              </span>
            </Label>
            <Input
              value={formData.social_links.github || ''}
              onChange={(e) => updateSocialLink('github', e.target.value)}
              placeholder="username"
              className="input input-bordered w-full"
            />
          </div>

          <div className="form-control">
            <Label className="label">
              <span className="label-text flex items-center space-x-2">
                <Globe className="w-4 h-4" />
                <span>ウェブサイト</span>
              </span>
            </Label>
            <Input
              type="url"
              value={formData.social_links.website || ''}
              onChange={(e) => updateSocialLink('website', e.target.value)}
              placeholder="https://yoursite.com"
              className="input input-bordered w-full"
            />
          </div>
        </div>
      </div>

      {/* Privacy Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('profile.privacySettings')}</h3>
        
        <div className="form-control">
          <div className="flex items-center justify-between p-4 bg-base-200 rounded-lg">
            <div className="space-y-1">
              <Label className="text-sm font-medium">{t('profile.publicProfile')}</Label>
              <p className="text-xs text-base-content/70">
                {t('profile.publicProfileDescription')}
              </p>
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

      {/* Submit Button */}
      <div className="pt-4">
        <Button 
          type="submit" 
          disabled={loading}
          className="btn btn-primary w-full"
        >
          {loading ? (
            <>
              <span className="loading loading-spinner loading-sm"></span>
              {t('common.saving')}
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {t('profile.saveChanges')}
            </>
          )}
        </Button>
      </div>
    </form>
  );
};