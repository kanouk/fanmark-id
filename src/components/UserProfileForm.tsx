import { useRef, useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import { Save, User, Upload, Trash2, Loader2 } from 'lucide-react';
import { FanmarkSelectionModal } from './FanmarkSelectionModal';
import { useAuth } from '@/hooks/useAuth';
import {
  getPlanLimit,
  evaluatePlanDowngrade,
  type PlanType,
  type ActiveFanmark,
} from '@/lib/plan-utils';
import { supabase } from '@/integrations/supabase/client';
import { useLocation, useNavigate } from 'react-router-dom';

interface UserSettings {
  display_name: string | null;
  username: string;
  avatar_url: string | null;
  plan_type: PlanType;
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
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [showFanmarkSelection, setShowFanmarkSelection] = useState(false);
  const [pendingPlanChange, setPendingPlanChange] = useState<PlanType | null>(null);
  const [currentFanmarks, setCurrentFanmarks] = useState<ActiveFanmark[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    display_name: profile?.display_name ?? '',
    username: profile?.username ?? '',
    avatar_url: profile?.avatar_url ?? '',
    plan_type: (profile?.plan_type ?? 'free') as PlanType,
  });

  const getPlanLabel = (planType: PlanType) => {
    switch (planType) {
      case 'creator':
        return t('userSettings.planTypeCreator');
      case 'business':
        return t('userSettings.planTypeBusiness');
      case 'enterprise':
        return t('userSettings.planTypeEnterprise');
      case 'admin':
        return t('userSettings.planTypeAdmin');
      case 'free':
      default:
        return t('userSettings.planTypeFree');
    }
  };

  const getPlanLimitCopy = (planType: PlanType) => {
    const limit = getPlanLimit(planType);
    if (limit === -1) {
      return t('userSettings.planUnlimited');
    }
    return t('userSettings.planLimitInfo', { limit });
  };

  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      plan_type: (profile?.plan_type ?? 'free') as PlanType,
    }));
  }, [profile?.plan_type]);

  const checkForPlanDowngrade = async (newPlanType: PlanType) => {
    const currentPlanType = (profile?.plan_type || 'free') as PlanType;

    try {
      const { requiresSelection, fanmarks } = await evaluatePlanDowngrade(
        user?.id,
        currentPlanType,
        newPlanType
      );

      if (requiresSelection) {
        setCurrentFanmarks(fanmarks as ActiveFanmark[]);
        setPendingPlanChange(newPlanType);
        setShowFanmarkSelection(true);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error evaluating plan downgrade:', error);
      throw error;
    }
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
        const { error: bulkReturnError, data: bulkReturnData } = await supabase.functions.invoke<{
          success: boolean;
          failed?: Array<{ licenseId: string; error: string }>;
        }>('bulk-return-fanmarks', {
          body: { license_ids: unselectedLicenseIds },
        });

        if (bulkReturnError) {
          throw bulkReturnError;
        }

        if (bulkReturnData?.failed && bulkReturnData.failed.length > 0) {
          console.error('Failed to return some fanmarks:', bulkReturnData.failed);
          throw new Error('Failed to return selected fanmarks');
        }
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-background/80 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{getPlanLabel(formData.plan_type)}</p>
                <p className="text-xs text-muted-foreground">{getPlanLimitCopy(formData.plan_type)}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                onClick={() => navigate('/plans', { state: { from: location.pathname } })}
              >
                {t('userSettings.changePlan')}
              </Button>
            </div>
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
