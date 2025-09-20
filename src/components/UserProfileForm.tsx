import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Save, User, Link as LinkIcon, Globe, Instagram, Github, Twitter } from 'lucide-react';

interface UserProfileFormProps {
  profile: any;
  onUpdate: (data: any) => Promise<void>;
}

export const UserProfileForm = ({ profile, onUpdate }: UserProfileFormProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
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
            className="input input-bordered w-full"
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
            maxLength={160}
          />
          <div className="label">
            <span className="label-text-alt">{formData.bio.length}/160</span>
          </div>
        </div>

        <div className="form-control">
          <Label htmlFor="avatar_url" className="label">
            <span className="label-text">{t('profile.avatarUrl')}</span>
          </Label>
          <Input
            id="avatar_url"
            type="url"
            value={formData.avatar_url}
            onChange={(e) => setFormData(prev => ({ ...prev, avatar_url: e.target.value }))}
            placeholder="https://example.com/avatar.jpg"
            className="input input-bordered w-full"
          />
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
                <Globe className="w-4 h-4" />
                <span>{t('profile.website')}</span>
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

          <div className="form-control">
            <Label className="label">
              <span className="label-text flex items-center space-x-2">
                <Twitter className="w-4 h-4" />
                <span>Twitter/X</span>
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
                <Instagram className="w-4 h-4" />
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
                <Github className="w-4 h-4" />
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
        </div>
      </div>

      {/* Privacy Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('profile.privacySettings')}</h3>
        
        <div className="form-control">
          <div className="flex items-center justify-between p-4 bg-base-200 rounded-lg">
            <div className="space-y-1">
              <Label className="text-sm font-medium">{t('profile.publicProfile')}</Label>
              <p className="text-xs text-muted-foreground">
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