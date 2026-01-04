import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useEmojiProfile } from '@/hooks/useEmojiProfile';
import { EmojiProfileForm } from '@/components/EmojiProfileForm';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, PenLine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { LanguageToggle } from '@/components/LanguageToggle';

export default function EmojiProfileEdit() {
  const { fanmarkId } = useParams<{ fanmarkId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [licenseId, setLicenseId] = useState<string | null>(null);
  const [licenseLoading, setLicenseLoading] = useState(true);

  const { profile, loading, updateProfile } = useEmojiProfile(licenseId!);

  // Fetch license_id from fanmarkId
  useEffect(() => {
    if (!user || !fanmarkId) return;

    const fetchLicenseId = async () => {
      setLicenseLoading(true);
      try {
        const { data, error } = await supabase
          .from('fanmark_licenses')
          .select('id')
          .eq('fanmark_id', fanmarkId)
          .eq('user_id', user.id)
          .eq('status', 'active')
          .gt('license_end', new Date().toISOString())
          .single();

        if (error) {
          console.error('Error fetching license:', error);
          toast({
            title: t('emojiProfile.licenseError'),
            description: t('emojiProfile.licenseErrorDescription'),
            variant: 'destructive',
          });
          navigate(`/fanmarks/${fanmarkId}/settings`);
          return;
        }

        setLicenseId(data.id);
      } catch (error) {
        console.error('Error fetching license:', error);
        toast({
          title: t('emojiProfile.licenseError'),
          description: t('emojiProfile.licenseErrorDescription'),
          variant: 'destructive',
        });
        navigate(`/fanmarks/${fanmarkId}/settings`);
      } finally {
        setLicenseLoading(false);
      }
    };

    fetchLicenseId();
  }, [user, fanmarkId, navigate, t]);

  useEffect(() => {
    if (!user) {
      navigate('/auth', { 
        state: { from: location },
        replace: true 
      });
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

  const handlePreview = () => {
    navigate(`/fanmarks/${fanmarkId}/profile/preview`, {
      state: { from: 'profile-edit' }
    });
  };

  if (!user) {
    return null;
  }

  if (licenseLoading || loading || !licenseId) {
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
      {/* Top Navigation */}
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border/40">
        <div className="container mx-auto px-4 py-4 flex items-center">
          <div className="w-24 flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-10 w-10 rounded-full border border-primary/20 bg-background/90 text-foreground hover:bg-primary/10"
              aria-label={t('common.back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
          <h1 className="flex-1 text-sm sm:text-base md:text-xl font-bold tracking-tight text-foreground text-center flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap">
            <PenLine className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
            {t('emojiProfile.editProfileTitle')}
          </h1>
          <div className="w-24 flex items-center justify-end">
            <LanguageToggle />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Form */}
          <EmojiProfileForm
            profile={profile}
            onSave={handleSave}
            isSubmitting={isSubmitting}
            onClose={handleClose}
            onPreview={handlePreview}
            draftStorageKey={licenseId ? `emoji_profile_draft_${licenseId}` : undefined}
          />
        </div>
      </div>
    </div>
  );
}
