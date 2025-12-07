import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, MessageSquare } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { getFanmarkUrlForClipboard } from '@/utils/emojiUrl';

interface FanmarkData {
  user_input_fanmark: string;
  fanmark?: string;
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
            className="text-primary hover:text-primary/80 underline underline-offset-4 decoration-2 transition-colors font-medium break-words"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const handleCopyUrl = () => {
    const url = getFanmarkUrlForClipboard(fanmark.fanmark || fanmark.user_input_fanmark, 'https://fanmark.id');
    navigator.clipboard.writeText(url);
    toast({
      title: t('common.linkCopied'),
      description: url,
    });
  };

  const fanmarkValue = fanmark.fanmark || fanmark.user_input_fanmark || '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-background flex flex-col relative overflow-hidden">
      {/* Decorative floating elements */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-gradient-to-br from-primary/8 to-transparent rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-accent/8 to-transparent rounded-full blur-3xl translate-x-1/2" />
      <div className="absolute bottom-0 left-1/3 w-[600px] h-[400px] bg-gradient-to-t from-primary/5 to-transparent rounded-full blur-3xl translate-y-1/2" />
      
      <SimpleHeader className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur-xl" />

      <main className="container mx-auto px-4 py-8 md:py-12 flex-1 relative z-10">
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
                    {fanmarkValue}
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
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
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

                {/* Copy URL Button */}
                <div className="mt-8 flex justify-center">
                  <Button
                    onClick={handleCopyUrl}
                    variant="outline"
                    className="rounded-full px-6 h-10 gap-2 border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all"
                  >
                    <Copy className="h-4 w-4" />
                    {t('common.copyUrl')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <SiteFooter className="border-border/40 bg-background/80 backdrop-blur relative z-10" />
    </div>
  );
};
