import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Home, MessageSquare, Copy } from 'lucide-react';
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

  const displayName = fanmark.display_name || 'Message Board';
  const message = fanmark.text_content || 'No message available.';

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-8xl mb-4">{fanmark.emoji_combination}</div>
          <h1 className="text-3xl font-bold mb-2">{displayName}</h1>
          <Badge variant="secondary" className="mb-4">
            <MessageSquare className="h-3 w-3 mr-1" />
            Message Board
          </Badge>
        </div>

        {/* Message Content */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Message
              </h2>
              
              <div className="bg-muted/30 rounded-lg p-4 min-h-[100px]">
                <p className="whitespace-pre-wrap text-foreground leading-relaxed">
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

        {/* Back to Home */}
        <div className="text-center">
          <Button onClick={() => navigate('/')} variant="outline">
            <Home className="h-4 w-4 mr-2" />
            Go to Home
          </Button>
        </div>
      </div>
    </div>
  );
};