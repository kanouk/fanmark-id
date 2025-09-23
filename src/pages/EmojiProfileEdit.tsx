import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useEmojiProfile } from '@/hooks/useEmojiProfile';
import { EmojiProfileForm } from '@/components/EmojiProfileForm';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, User, Palette, X } from 'lucide-react';

export default function EmojiProfileEdit() {
  const { fanmarkId } = useParams<{ fanmarkId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { profile, loading, updateProfile } = useEmojiProfile(fanmarkId!);

  useEffect(() => {
    if (!user) {
      navigate('/auth', { 
        state: { from: location },
        replace: true 
      });
      return;
    }
  }, [user, navigate, location]);

  const handleSave = async (data: any) => {
    setIsSubmitting(true);
    try {
      await updateProfile(data);
      toast({
        title: t('emojiProfile.updateSuccess'),
        description: t('emojiProfile.updateSuccessDescription'),
      });
      navigate(`/fanmarks/${fanmarkId}/settings`);
    } catch (error) {
      console.error('Profile update error:', error);
      toast({
        title: t('emojiProfile.updateError'),
        description: error instanceof Error ? error.message : t('emojiProfile.updateErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    navigate(`/fanmarks/${fanmarkId}/settings`);
  };

  if (!user) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          {t('common.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12 sm:px-8 lg:px-12">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/20 to-primary/10 text-primary mx-auto">
            <User className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
              {t('emojiProfile.editProfileTitle')}
            </h1>
            <p className="text-base text-muted-foreground max-w-2xl mx-auto">
              {t('emojiProfile.editProfileDescription')}
            </p>
          </div>
        </div>

        {/* Profile Preview Card */}
        <div className="rounded-3xl border border-border/50 bg-card/80 shadow-lg shadow-primary/10 backdrop-blur p-8">
          <div className="flex items-center gap-3 mb-6">
            <Palette className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">
              {t('emojiProfile.profilePreview')}
            </h2>
          </div>
          
          {/* Preview */}
          <div className="bg-background/80 rounded-2xl p-6 border border-border/30">
            <div className="text-center">
              {profile?.theme_settings?.cover_image_url && (
                <div className="w-full h-40 mb-6 rounded-xl overflow-hidden">
                  <img
                    src={profile.theme_settings.cover_image_url}
                    alt="Cover"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="space-y-3">
                {profile?.theme_settings?.profile_image_url && (
                  <div className="w-24 h-24 mx-auto mb-6">
                    <img
                      src={profile.theme_settings.profile_image_url}
                      alt="Profile"
                      className="w-full h-full object-cover rounded-full border-3 border-primary/20"
                    />
                  </div>
                )}
                <h3 className="font-semibold text-xl">
                  {profile?.bio ? t('emojiProfile.profilePreviewTitle') : t('emojiProfile.defaultProfileTitle')}
                </h3>
                {profile?.bio && (
                  <p className="text-base text-muted-foreground max-w-md mx-auto">{profile.bio}</p>
                )}
                {profile?.social_links && Object.keys(profile.social_links).length > 0 && (
                  <div className="flex justify-center gap-3 mt-6">
                    {Object.entries(profile.social_links).map(([platform, url]) => (
                      url && (
                        <div
                          key={platform}
                          className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"
                          style={{ backgroundColor: `${profile.theme_settings?.theme_color || '#3B82F6'}20` }}
                        >
                          <span className="text-sm font-semibold">
                            {platform.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <EmojiProfileForm
          profile={profile}
          onSave={handleSave}
          isSubmitting={isSubmitting}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}