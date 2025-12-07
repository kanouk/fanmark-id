import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { FanmarkSettings, Fanmark as FanmarkSettingsData } from '@/components/FanmarkSettings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { resolveFanmarkDisplay } from '@/lib/emojiConversion';
import { showEmojiConfetti } from '@/lib/emojiConfetti';

interface FanmarkRecord {
  id: string;
  user_input_fanmark: string;
  emoji_ids: string[];
  fanmark_name: string | null;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url: string | null;
  text_content: string | null;
  is_transferable: boolean;
  status: string;
  short_id: string;
  is_public: boolean;
}

const FanmarkSettingsPage = () => {
  const { fanmarkId } = useParams<{ fanmarkId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [fanmark, setFanmark] = useState<FanmarkSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadFanmark = useCallback(async () => {
    if (!fanmarkId) return;

    setLoading(true);
    setFetchError(null);

    try {
      // Use the new comprehensive function to get all fanmark data
      const { data, error } = await supabase.rpc('get_fanmark_complete_data', {
        fanmark_id_param: fanmarkId
      });

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        setFetchError(t('fanmarkSettings.errors.notFound'));
        setFanmark(null);
        return;
      }

      const fanmarkData = data[0]; // Get first result since function returns array
      const isNew = location.state?.isNew || false;
      const restoreEditingState = location.state?.restoreEditingState;

      // Check if license is expired or in grace period
      if (!fanmarkData.has_active_license) {
        setFetchError(t('fanmarkSettings.errors.graceStatusEdit'));
        setFanmark(null);
        toast({
          title: t('fanmarkSettings.errors.graceStatusEdit'),
          description: t('fanmarkSettings.errors.graceStatusDescription'),
          variant: 'destructive',
        });
        return;
      }

      const emojiIds = Array.isArray(fanmarkData.emoji_ids)
        ? (fanmarkData.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
        : [];

      // Fetch is_public from fanmark_profiles table (regardless of access_type to preserve setting)
      let isPublic = false;
      if (fanmarkData.license_id) {
        const { data: profileData, error: profileError } = await supabase
          .from('fanmark_profiles')
          .select('is_public')
          .eq('license_id', fanmarkData.license_id)
          .maybeSingle();

        if (!profileError && profileData) {
          isPublic = profileData.is_public ?? false;
        }
      }

      setFanmark({
        id: fanmarkData.id,
        user_input_fanmark: fanmarkData.user_input_fanmark,
        emoji_ids: emojiIds,
        fanmark: resolveFanmarkDisplay(fanmarkData.user_input_fanmark, emojiIds),
        fanmark_name: fanmarkData.fanmark_name?.trim() || null,
        access_type: fanmarkData.access_type as 'profile' | 'redirect' | 'text' | 'inactive',
        target_url: fanmarkData.target_url ?? undefined,
        text_content: fanmarkData.text_content ?? undefined,
        is_password_protected: fanmarkData.is_password_protected ?? false,
        status: fanmarkData.status,
        short_id: fanmarkData.short_id,
        license_id: fanmarkData.license_id,
        is_public: isPublic,

      });
    } catch (error) {
      console.error('Failed to load fanmark:', error);
      setFetchError(t('fanmarkSettings.errors.loadFailed'));
      setFanmark(null);
    } finally {
      setLoading(false);
    }
  }, [fanmarkId, t]);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      toast({
        title: t('fanmarkSettings.errors.authRequiredTitle'),
        description: t('fanmarkSettings.errors.authRequiredDescription'),
        variant: 'destructive',
      });
      navigate('/auth', { replace: true });
      return;
    }

    if (!fanmarkId) {
      navigate('/dashboard', { replace: true });
      return;
    }

    loadFanmark();
  }, [authLoading, fanmarkId, user, loadFanmark, navigate, toast, t]);

  // 新規取得時の紙吹雪アニメーション
  useEffect(() => {
    // データ読み込み完了 && fanmark が存在 && 新規取得フラグがある場合
    if (!loading && fanmark && location.state?.isNew) {
      // 紙吹雪を発動
      showEmojiConfetti(fanmark.user_input_fanmark);
      
      // history.state から isNew フラグを削除（ブラウザバック時の再発動を防止）
      const newState = { ...location.state };
      delete newState.isNew;
      window.history.replaceState(newState, document.title);
    }
  }, [loading, fanmark, location.state]);

  const handleClose = () => {
    navigate('/dashboard');
  };

  const handleSuccess = () => {
    toast({
      title: t('fanmarkSettings.toast.successTitle'),
      description: t('fanmarkSettings.toast.successDescription'),
    });
    // データを再読み込みしてからダッシュボードに遷移
    loadFanmark().then(() => {
      navigate('/dashboard');
    }).catch(() => {
      // エラーが発生してもダッシュボードに遷移
      navigate('/dashboard');
    });
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="flex items-center gap-3 rounded-full border border-primary/20 bg-background/90 px-5 py-3 shadow-lg">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">
            {t('common.loading')}
          </span>
        </div>
      </div>
    );
  }

  if (fetchError || !fanmark) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-16 text-center">
          <Card className="w-full border border-destructive/20 bg-background/95 shadow-[0_25px_60px_rgba(244,63,94,0.18)]">
            <CardContent className="space-y-4 p-8">
              <h2 className="text-xl font-semibold text-destructive">
                {t('fanmarkSettings.errors.loadFailedTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">{fetchError}</p>
              <Button onClick={handleClose} className="rounded-full">
                {t('common.back')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // location state から編集状態復元データを取得
  const restoreEditingState = location.state?.restoreEditingState;

  return (
    <FanmarkSettings
      fanmark={fanmark}
      mode="page"
      onClose={handleClose}
      onSuccess={handleSuccess}
      open
      onOpenChange={() => undefined}
      restoreEditingState={restoreEditingState}
    />
  );
};

export default FanmarkSettingsPage;
