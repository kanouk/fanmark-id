import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Share } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { LanguageToggle } from '@/components/LanguageToggle';
import { getFanmarkUrlForClipboard } from '@/utils/emojiUrl';

interface FanmarkData {
  emoji_combination: string;
  fanmark_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  is_password_protected?: boolean;
}

interface FanmarkMessageProps {
  fanmark: FanmarkData;
}

export const FanmarkMessage = ({ fanmark }: FanmarkMessageProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

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

  const handleShare = async () => {
    const url = getFanmarkUrlForClipboard(fanmark.emoji_combination, 'https://fanmark.id');
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('messageBoard.title'),
          url: url,
        });
      } catch (error) {
        navigator.clipboard.writeText(url);
        toast({
          title: t('common.linkCopied'),
          description: url,
        });
      }
    } else {
      navigator.clipboard.writeText(url);
      toast({
        title: t('common.linkCopied'),
        description: url,
      });
    }
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

          <LanguageToggle />
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
};