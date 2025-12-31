import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, MessageSquare, Edit, Eye } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { LanguageToggle } from '@/components/LanguageToggle';
import { supabase } from '@/integrations/supabase/client';

interface Fanmark {
  id: string;
  user_input_fanmark: string;
  display_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
  fanmark_name: string | null;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  is_password_protected?: boolean;
}

export default function FanmarkMessageboardPreview() {
  const { fanmarkId } = useParams<{ fanmarkId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [fanmark, setFanmark] = useState<Fanmark | null>(null);
  const [loading, setLoading] = useState(true);

  // location state から渡されたプレビュー内容と編集状態を取得
  const locationState = location.state as {
    previewContent?: string;
    editingState?: any;
  } | null;

  useEffect(() => {
    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }

    const fetchFanmark = async () => {
      if (!fanmarkId) return;

      setLoading(true);
      try {
        // Use the same RPC function as FanmarkSettingsPage
        const { data, error } = await supabase.rpc('get_fanmark_complete_data', {
          fanmark_id_param: fanmarkId
        });

        if (error) throw error;

        if (!data || data.length === 0) {
          console.error('Fanmark not found');
          navigate('/dashboard');
          return;
        }

        const fanmarkData = data[0];
        const emojiIds = Array.isArray(fanmarkData.emoji_ids)
          ? (fanmarkData.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
          : [];
        const displayFanmark = fanmarkData.display_fanmark ?? '';

        const fanmark: Fanmark = {
          id: fanmarkData.id,
          user_input_fanmark: fanmarkData.user_input_fanmark,
          display_fanmark: displayFanmark,
          emoji_ids: emojiIds,
          fanmark: displayFanmark,
          fanmark_name: fanmarkData.fanmark_name || displayFanmark,
          access_type: fanmarkData.access_type as 'profile' | 'redirect' | 'text' | 'inactive',
          text_content: fanmarkData.text_content || '',
          is_password_protected: fanmarkData.is_password_protected || false,
        };

        setFanmark(fanmark);
      } catch (error) {
        console.error('Error fetching fanmark:', error);
        navigate('/dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchFanmark();
  }, [user, navigate, fanmarkId]);

  if (!user || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-primary/20 bg-background/90 px-5 py-3 shadow-lg">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (!fanmark) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex items-center justify-center">
        <div className="text-muted-foreground">Fanmark not found</div>
      </div>
    );
  }

  // プレビュー内容を決定（優先順位: location state > DB の内容 > デフォルト）
  const message = locationState?.previewContent !== undefined
    ? (locationState.previewContent || 'メッセージがありません')
    : (fanmark?.text_content || 'メッセージがありません');

  // URLをリンクに変換する関数
  const linkifyText = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary/80 underline underline-offset-4 decoration-2 transition-colors font-medium break-words"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const handleClose = () => {
    navigate(`/fanmarks/${fanmarkId}/settings`, {
      state: {
        restoreEditingState: locationState?.editingState,
      },
    });
  };

  const handleEdit = () => {
    navigate(`/fanmarks/${fanmarkId}/settings`, {
      state: {
        restoreEditingState: locationState?.editingState,
      },
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background relative overflow-hidden">
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
            <Eye className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
            {t('messageBoard.previewTitle')}
          </h1>
          <div className="w-24 flex items-center justify-end">
            <LanguageToggle />
          </div>
        </div>
      </div>

      {/* Decorative floating elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-gradient-to-br from-primary/8 to-transparent rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-accent/8 to-transparent rounded-full blur-3xl translate-x-1/2" />
        <div className="absolute bottom-0 left-1/3 w-[600px] h-[400px] bg-gradient-to-t from-primary/5 to-transparent rounded-full blur-3xl translate-y-1/2" />
      </div>

      {/* Content */}
      <main className="container mx-auto px-4 py-8 pb-32 relative z-10">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Main Message Card */}
          <Card className="overflow-hidden rounded-3xl border border-primary/15 bg-background/90 backdrop-blur-xl shadow-[0_30px_60px_rgba(101,195,200,0.12)] card-pop">
            <CardContent className="p-0">
              {/* Cover Area - Same style as Profile */}
              <div className="relative h-48 md:h-56 bg-gradient-to-br from-primary/20 via-accent/15 to-primary/10">
                {/* Decorative pattern */}
                <div className="absolute inset-0">
                  <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-primary/20 rounded-full blur-2xl animate-float" />
                  <div className="absolute bottom-1/4 right-1/4 w-24 h-24 bg-accent/25 rounded-full blur-2xl animate-float" style={{ animationDelay: '1s' }} />
                  <div className="absolute top-1/2 right-1/3 w-20 h-20 bg-primary/15 rounded-full blur-xl animate-float" style={{ animationDelay: '2s' }} />
                </div>
                
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
                
                {/* Fanmark Badge - Same position as Profile */}
                <div className="absolute top-4 left-4">
                  <span className="inline-flex items-center px-4 py-2 text-xl md:text-2xl font-semibold text-primary tracking-[0.3em] leading-none rounded-2xl bg-background/90 backdrop-blur-md shadow-lg border border-primary/10">
                    {fanmark.fanmark}
                  </span>
                </div>

                {/* Message Icon - Same position as Profile Image */}
                <div className="absolute -bottom-14 left-1/2 transform -translate-x-1/2">
                  <div className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-br from-primary/50 via-accent/30 to-primary/50 rounded-full blur-sm opacity-60 group-hover:opacity-80 transition-opacity" />
                    <div className="relative w-28 h-28 rounded-full overflow-hidden border-4 border-background shadow-xl bg-gradient-to-br from-primary/20 via-accent/15 to-primary/10 flex items-center justify-center">
                      <MessageSquare className="h-12 w-12 text-primary/70" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Message Content */}
              <div className="px-6 md:px-8 pt-20 pb-8">
                <div className="text-center space-y-4">
                  {/* Title */}
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                    {t('messageBoard.title')}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {t('messageBoard.messageFromOwner')}
                  </p>
                </div>

                {/* Message Box */}
                <div className="mt-8">
                  <div className="bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5 rounded-2xl p-6 md:p-8 border border-primary/10">
                    <div className="whitespace-pre-wrap break-words text-foreground/90 leading-relaxed text-base md:text-lg tracking-wide text-center">
                      {linkifyText(message)}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Bottom Navigation Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border/40 p-6">
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={handleEdit}
            className="px-6 h-10 text-sm rounded-2xl border-primary/20 hover:border-primary/40 hover:bg-primary/5"
          >
            <Edit className="h-5 w-5 mr-2" />
            {t('emojiProfile.backToEdit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
