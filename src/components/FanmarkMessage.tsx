import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';

interface FanmarkData {
  emoji_combination: string;
  display_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
}

interface FanmarkMessageProps {
  fanmark: FanmarkData;
}

export const FanmarkMessage = ({ fanmark }: FanmarkMessageProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleCopyMessage = async () => {
    if (fanmark.text_content) {
      try {
        await navigator.clipboard.writeText(fanmark.text_content);
        toast({
          title: 'Message copied',
          description: 'The message has been copied to your clipboard.',
        });
      } catch (err) {
        console.error('Failed to copy message:', err);
        toast({
          title: 'Copy failed',
          description: 'Failed to copy the message.',
          variant: 'destructive',
        });
      }
    }
  };

  const message = fanmark.text_content || 'No message available.';

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-8xl mb-4">{fanmark.emoji_combination}</div>
        </div>

        {/* Message Content */}
        <Card className="mb-8">
          <CardContent className="p-8">
            <div className="space-y-6">
              <div className="bg-muted/30 rounded-lg p-6 min-h-[120px]">
                <p className="whitespace-pre-wrap text-foreground leading-relaxed text-lg">
                  {message}
                </p>
              </div>

              {fanmark.text_content && (
                <div className="flex justify-end">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleCopyMessage}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Message
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* fanmark.id Logo */}
        <div className="text-center">
          <Button 
            onClick={() => navigate('/')} 
            variant="ghost"
            className="text-lg font-bold hover:bg-transparent p-0"
          >
            fanmark.id
          </Button>
        </div>
      </div>
    </div>
  );
};