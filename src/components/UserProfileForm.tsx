import { useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import { Save, User, Upload, Trash2, Loader2 } from 'lucide-react';
import { FanmarkSelectionModal } from './FanmarkSelectionModal';
import { supabase } from '@/integrations/supabase/client';
import { useFanmarkLimit } from '@/hooks/useFanmarkLimit';
import { useAuth } from '@/hooks/useAuth';

interface UserSettings {
  display_name: string | null;
  username: string;
  avatar_url: string | null;
  plan_type: 'free' | 'creator' | 'business' | 'enterprise' | 'admin';
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
  const { user } = useAuth();
  const { uploadAvatar, deleteAvatar, uploading } = useAvatarUpload();
  const [loading, setLoading] = useState(false);
  const [showFanmarkSelection, setShowFanmarkSelection] = useState(false);
  const [pendingPlanChange, setPendingPlanChange] = useState<'free' | 'creator' | 'business' | 'enterprise' | 'admin' | null>(null);
  const [currentFanmarks, setCurrentFanmarks] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    display_name: profile?.display_name ?? '',
    username: profile?.username ?? '',
    avatar_url: profile?.avatar_url ?? '',
    plan_type: profile?.plan_type ?? 'free' as 'free' | 'creator' | 'business' | 'enterprise' | 'admin',
    preferred_language: profile?.preferred_language ?? 'en' as 'en' | 'ja',
  });

  const getPlanLimit = (planType: 'free' | 'creator' | 'business' | 'enterprise' | 'admin'): number => {
    switch (planType) {
      case 'free': return 3;
      case 'creator': return 10;
      case 'business': return 50;
      case 'enterprise': return 100;
      case 'admin': return -1; // unlimited
      default: return 3;
    }
  };

  const checkForPlanDowngrade = async (newPlanType: 'free' | 'creator' | 'business' | 'enterprise' | 'admin') => {
    const currentPlanType = profile?.plan_type || 'free';
    const currentLimit = getPlanLimit(currentPlanType);
    const newLimit = getPlanLimit(newPlanType);
    
    // Skip check for admin (unlimited) or if not actually downgrading
    if (newPlanType === 'admin' || newLimit >= currentLimit) {
      return false;
    }

    // Fetch current active fanmarks with license details
    const { data: licenses, error } = await supabase
      .from('fanmark_licenses')
      .select(`
        id,
        fanmark_id,
        license_end,
        fanmarks (
          id,
          emoji_combination
        ),
        fanmark_basic_configs (
          fanmark_name,
          access_type
        )
      `)
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .gt('license_end', new Date().toISOString());

    if (error) throw error;

    const activeFanmarks = licenses?.map(license => ({
      id: license.fanmark_id,
      emoji_combination: (license.fanmarks as any)?.emoji_combination || '',
      fanmark_name: (license.fanmark_basic_configs as any)?.fanmark_name || null,
      license_id: license.id,
      license_end: license.license_end,
      access_type: (license.fanmark_basic_configs as any)?.access_type || null
    })) || [];

    // Check if downgrade requires fanmark selection
    if (activeFanmarks.length > newLimit) {
      setCurrentFanmarks(activeFanmarks);
      setPendingPlanChange(newPlanType);
      setShowFanmarkSelection(true);
      return true;
    }

    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Check if this is a plan downgrade that requires fanmark selection
      const requiresSelection = await checkForPlanDowngrade(formData.plan_type);
      
      if (requiresSelection) {
        setLoading(false);
        return; // Modal will handle the rest
      }

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

  const handleFanmarkSelectionConfirm = async (selectedFanmarkIds: string[]) => {
    if (!pendingPlanChange) return;

    try {
      // Update plan first
      const updatedFormData = { ...formData, plan_type: pendingPlanChange };
      await onUpdate(updatedFormData);

      // Update plan exclusion for unselected fanmarks
      const unselectedLicenseIds = currentFanmarks
        .filter(fm => !selectedFanmarkIds.includes(fm.id))
        .map(fm => fm.license_id);

      if (unselectedLicenseIds.length > 0) {
        const { error } = await supabase
          .from('fanmark_licenses')
          .update({
            plan_excluded: true,
            excluded_at: new Date().toISOString(),
            excluded_from_plan: profile?.plan_type || 'free'
          })
          .in('id', unselectedLicenseIds);

        if (error) throw error;
      }

      setFormData(updatedFormData);
      setShowFanmarkSelection(false);
      setPendingPlanChange(null);
      setCurrentFanmarks([]);

      toast({
        title: '✨ ' + t('planDowngrade.successTitle'),
        description: t('planDowngrade.successDescription'),
      });

    } catch (error) {
      toast({
        title: t('planDowngrade.errorTitle'),
        description: t('planDowngrade.errorDescription'),
        variant: 'destructive',
      });
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
              onChange={(e) => setFormData(prev => ({ ...prev, plan_type: e.target.value as 'free' | 'creator' | 'business' | 'admin' }))}
              className="h-11 w-full rounded-2xl border border-primary/15 bg-background/80 px-3 text-base shadow-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="free">{t('userSettings.planTypeFree')}</option>
              <option value="creator">{t('userSettings.planTypeCreator')}</option>
              <option value="business">{t('userSettings.planTypeBusiness')}</option>
              <option value="admin">{t('userSettings.planTypeAdmin')}</option>
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

      {/* Fanmark Selection Modal */}
      {showFanmarkSelection && pendingPlanChange && (
        <FanmarkSelectionModal
          isOpen={showFanmarkSelection}
          onClose={() => {
            setShowFanmarkSelection(false);
            setPendingPlanChange(null);
            setCurrentFanmarks([]);
          }}
          newPlanType={pendingPlanChange}
          newPlanLimit={getPlanLimit(pendingPlanChange)}
          currentFanmarks={currentFanmarks}
          onConfirm={handleFanmarkSelectionConfirm}
        />
      )}
    </form>
  );
};