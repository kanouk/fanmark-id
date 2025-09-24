import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';

interface FanmarkData {
  emoji_combination: string;
  fanmark_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  is_password_protected?: boolean;
  access_password?: string;
}

interface FanmarkMessageProps {
  fanmark: FanmarkData;
}

export const FanmarkMessage = ({ fanmark }: FanmarkMessageProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const message = fanmark.text_content || 'No message available.';

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Title */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-foreground">ミニ伝言板</h1>
        </div>

        {/* Fanmark */}
        <div className="text-center mb-8">
          <div className="text-8xl mb-4">{fanmark.emoji_combination}</div>
        </div>

        {/* Message Content */}
        <Card className="mb-12">
          <CardContent className="p-8">
            <div className="bg-muted/30 rounded-lg p-6 min-h-[120px]">
              <p className="whitespace-pre-wrap text-foreground leading-relaxed text-lg">
                {message}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* fanmark.id Logo with Tagline */}
        <div className="flex flex-col items-center justify-center">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px] mb-2"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
              ✨
            </span>
            <span className="text-gradient text-2xl">fanmark.id</span>
          </button>
          <p className="text-sm text-muted-foreground">あなたもファンマを手に入れよう</p>
        </div>
      </div>
    </div>
  );
};