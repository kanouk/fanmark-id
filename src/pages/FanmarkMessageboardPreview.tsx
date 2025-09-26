import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { LanguageToggle } from '@/components/LanguageToggle';
import { supabase } from '@/integrations/supabase/client';

interface Fanmark {
  id: string;
  emoji_combination: string;
  fanmark_name: string | null;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  is_password_protected?: boolean;
}

export default function FanmarkMessageboardPreview() {
  const { fanmarkId } = useParams<{ fanmarkId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [fanmark, setFanmark] = useState<Fanmark | null>(null);
  const [loading, setLoading] = useState(true);

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

        const fanmark: Fanmark = {
          id: fanmarkData.id,
          emoji_combination: fanmarkData.emoji_combination,
          fanmark_name: fanmarkData.fanmark_name || fanmarkData.emoji_combination,
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
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  if (!fanmark) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-muted-foreground">Fanmark not found</div>
      </div>
    );
  }

  const message = fanmark.text_content || 'メッセージがありません';

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
            className="text-primary hover:text-primary/80 underline underline-offset-4 decoration-2 transition-colors font-medium"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      {/* Header Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
              ✨
            </span>
            <span className="text-gradient text-2xl">fanmark.id</span>
          </button>

          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => navigate(`/fanmarks/${fanmarkId}/settings`)}
              className="flex items-center gap-2 rounded-full"
            >
              <ArrowLeft className="h-4 w-4" />
              編集
            </Button>
            <LanguageToggle />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Message Content Section */}
          <Card className="overflow-hidden bg-gradient-to-br from-background/90 to-background/70 border border-primary/20 shadow-xl backdrop-blur-sm">
            <CardContent className="p-0">
              {/* Header */}
              <div className="relative bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10 px-8 py-12">
                <div className="text-center">
                  <div className="inline-flex items-center gap-3 mb-6">
                    <span className="text-6xl">{fanmark.emoji_combination}</span>
                  </div>
                  <h1 className="text-3xl font-bold text-foreground mb-2">{t('messageBoard.title')}</h1>
                  <p className="text-muted-foreground">{t('messageBoard.messageFromOwner')}</p>
                </div>
              </div>

              {/* Message Content */}
              <div className="px-8 py-12">
                <div className="max-w-3xl mx-auto">
                  <div className="bg-muted/30 rounded-lg p-8 min-h-[200px] flex items-center justify-center">
                    <div className="w-full text-center">
                      <div className="whitespace-pre-wrap text-foreground/90 leading-relaxed text-xl font-normal tracking-wide">
                        {linkifyText(message)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-background/80 backdrop-blur mt-16">
        <div className="container mx-auto px-4 py-10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
          </div>
          <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
        </div>
      </footer>
    </div>
  );
}