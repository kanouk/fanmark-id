import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useEmojiProfile } from '@/hooks/useEmojiProfile';
import { EmojiProfileForm } from '@/components/EmojiProfileForm';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, X, User } from 'lucide-react';

export default function EmojiProfileEdit() {
  const { fanmarkId } = useParams<{ fanmarkId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cachedFanmark, setCachedFanmark] = useState<{emoji_combination: string, display_name: string | null} | null>(null);

  const { profile, loading, updateProfile } = useEmojiProfile(fanmarkId!);

  useEffect(() => {
    if (!user) {
      navigate('/auth', { 
        state: { from: location },
        replace: true 
      });
      return;
    }

    // Load cached fanmark data from localStorage
    try {
      const cached = localStorage.getItem('fanmark_settings_cache');
      if (cached) {
        const data = JSON.parse(cached);
        // Check if data is less than 5 minutes old and matches current fanmarkId
        if (data.fanmarkId === fanmarkId && Date.now() - data.timestamp < 5 * 60 * 1000) {
          setCachedFanmark({
            emoji_combination: data.emoji_combination,
            display_name: data.display_name
          });
        }
      }
    } catch (error) {
      console.error('Error loading cached fanmark data:', error);
    }
  }, [user, navigate, location, fanmarkId]);

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
      {/* Close Button */}
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border/40">
        <div className="container mx-auto px-4 py-4 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="rounded-full h-10 w-10 p-0 hover:bg-primary/10"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Header */}
          <div className="text-center space-y-6">
            <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 via-accent/20 to-primary/10 flex items-center justify-center shadow-lg">
              {/* Display cached emoji combination, or fallback to user icon */}
              {cachedFanmark?.emoji_combination ? (
                <span className="text-4xl">{cachedFanmark.emoji_combination}</span>
              ) : (
                <User className="h-10 w-10 text-primary" />
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground mb-4 text-gradient">
                {t('emojiProfile.editProfileTitle')}
              </h1>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                {t('emojiProfile.editProfileDescription')}
              </p>
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
    </div>
  );
}