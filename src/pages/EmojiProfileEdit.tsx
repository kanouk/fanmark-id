import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useEmojiProfile } from '@/hooks/useEmojiProfile';
import { EmojiProfileForm } from '@/components/EmojiProfileForm';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, User, Palette } from 'lucide-react';

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

  const handleBack = () => {
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
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBack}
              className="flex items-center gap-2 rounded-full"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('common.back')}
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 text-primary">
                <User className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {t('emojiProfile.editProfileTitle')}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t('emojiProfile.editProfileDescription')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Preview Card */}
        <div className="rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur p-6">
          <div className="flex items-center gap-3 mb-4">
            <Palette className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">
              {t('emojiProfile.profilePreview')}
            </h2>
          </div>
          
          {/* Preview */}
          <div className="bg-background/80 rounded-xl p-4 border border-border/30">
            <div className="text-center">
              {profile?.theme_settings?.cover_image_url && (
                <div className="w-full h-32 mb-4 rounded-lg overflow-hidden">
                  <img
                    src={profile.theme_settings.cover_image_url}
                    alt="Cover"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="space-y-2">
                {profile?.theme_settings?.profile_image_url && (
                  <div className="w-20 h-20 mx-auto mb-4">
                    <img
                      src={profile.theme_settings.profile_image_url}
                      alt="Profile"
                      className="w-full h-full object-cover rounded-full border-2 border-primary/20"
                    />
                  </div>
                )}
                <h3 className="font-semibold text-lg">
                  {profile?.bio ? t('emojiProfile.profilePreviewTitle') : t('emojiProfile.defaultProfileTitle')}
                </h3>
                {profile?.bio && (
                  <p className="text-sm text-muted-foreground">{profile.bio}</p>
                )}
                {profile?.social_links && Object.keys(profile.social_links).length > 0 && (
                  <div className="flex justify-center gap-2 mt-4">
                    {Object.entries(profile.social_links).map(([platform, url]) => (
                      url && (
                        <div
                          key={platform}
                          className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"
                          style={{ backgroundColor: `${profile.theme_settings?.theme_color || '#3B82F6'}20` }}
                        >
                          <span className="text-xs font-semibold">
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
        />
      </div>
    </div>
  );
}