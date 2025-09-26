import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Home, AlertCircle } from 'lucide-react';
import { FanmarkProfile } from './FanmarkProfile';
import { FanmarkMessage } from './FanmarkMessage';
import { PasswordProtection } from './PasswordProtection';
import { useTranslation } from '@/hooks/useTranslation';

interface FanmarkData {
  id: string;
  emoji_combination: string;
  fanmark_name: string;
  access_type: 'profile' | 'redirect' | 'text' | 'inactive';
  target_url?: string;
  text_content?: string;
  status: string;
  is_password_protected?: boolean;
}

const normalizeEmojiPath = (path: string): string => {
  if (!path) return '';
  
  console.log('🔍 Normalizing emoji path:', { original: path, length: path.length });
  
  try {
    // Step 1: 安全なデコード（エンコード判定つき）
    let decoded = path;
    try {
      const testDecode = decodeURIComponent(path);
      if (testDecode !== path) {
        decoded = testDecode;
        console.log('📝 Decoded from percent-encoding:', { decoded });
      }
    } catch {
      // デコードエラーの場合はそのまま使用
    }
    
    // Step 2: Unicode NFC 正規化
    const normalized = decoded.normalize('NFC');
    
    // Step 3: 連続する Variation Selector-16 (U+FE0F) を単一化
    const cleanedUp = normalized.replace(/\uFE0F+/g, '\uFE0F');
    
    console.log('✨ Final normalized emoji:', { 
      original: path,
      decoded,
      normalized,
      cleanedUp,
      finalLength: cleanedUp.length
    });
    
    return cleanedUp;
  } catch (error) {
    console.error('❌ Emoji normalization error:', error, { path });
    return path;
  }
};

export const FanmarkAccess = () => {
  const { emojiPath } = useParams<{ emojiPath: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [fanmark, setFanmark] = useState<FanmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVerified, setIsPasswordVerified] = useState(false);

  useEffect(() => {
    const loadFanmark = async () => {
      if (!emojiPath) {
        setError(t('common.invalidFanmarkUrl'));
        setLoading(false);
        return;
      }

      try {
        // 絵文字パスの正規化処理
        const normalizedEmoji = normalizeEmojiPath(emojiPath);
        console.log('🎯 Final emoji for database query:', { normalizedEmoji, length: normalizedEmoji.length });
        
        // Use the secure function to get only essential fanmark data
        const { data, error } = await supabase
          .rpc('get_fanmark_by_emoji', { emoji_combo: normalizedEmoji });

        if (error) {
          console.error('Database error:', error);
          setError(t('common.failedToLoadFanmark'));
          setLoading(false);
          return;
        }

        if (!data || data.length === 0) {
          setError(t('common.fanmarkNotFound'));
          setLoading(false);
          return;
        }

        const fanmarkData = data[0] as FanmarkData;
        setFanmark(fanmarkData);
        
        // 成功後、URLを統一された形式に更新（ブラウザ履歴を置き換え）
        const currentPath = window.location.pathname;
        const expectedPath = `/${normalizedEmoji}`;
        if (currentPath !== expectedPath) {
          window.history.replaceState(null, '', expectedPath);
          console.log('🔄 URL normalized in address bar:', { from: currentPath, to: expectedPath });
        }

        // Immediately redirect if it's a redirect type without password protection
        if (fanmarkData.access_type === 'redirect' && 
            fanmarkData.target_url && 
            !fanmarkData.is_password_protected) {
          console.log('Redirecting to:', fanmarkData.target_url);
          window.location.href = fanmarkData.target_url;
          return; // Don't set loading to false, let the redirect happen
        }

        setLoading(false);
      } catch (err) {
        console.error('Error loading fanmark:', err);
        setError(t('common.failedToLoadFanmark'));
        setLoading(false);
      }
    };

    loadFanmark();
  }, [emojiPath]);

  // Trigger redirect after verification for redirect access types
  useEffect(() => {
    if (isPasswordVerified && fanmark?.access_type === 'redirect' && fanmark.target_url) {
      window.location.href = fanmark.target_url;
    }
  }, [isPasswordVerified, fanmark]);

  // Handle password verification success for all access types
  const handlePasswordSuccess = () => {
    setIsPasswordVerified(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">{t('common.loading')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !fanmark) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h1 className="text-xl font-semibold">{t('common.fanmarkNotFound')}</h1>
            <p className="text-muted-foreground">
              {error || t('common.fanmarkNotFoundDescription')}
            </p>
            <Button onClick={() => navigate('/')} className="w-full">
              <Home className="h-4 w-4 mr-2" />
              {t('common.goToHome')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Handle password protection for all access types
  if (fanmark.is_password_protected && !isPasswordVerified) {
    return (
      <PasswordProtection 
        fanmark={fanmark} 
        onSuccess={handlePasswordSuccess} 
      />
    );
  }

  // Handle different access types after password verification
  switch (fanmark.access_type) {
    case 'profile':
      return <FanmarkProfile fanmark={fanmark} />;
    
    case 'text':
      return <FanmarkMessage fanmark={fanmark} />;

    case 'redirect':
      return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
          <Card className="w-96">
            <CardContent className="p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-muted-foreground">{t('common.loading')}</p>
            </CardContent>
          </Card>
        </div>
      );
    
    case 'inactive':
      return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
          <Card className="w-96">
            <CardContent className="p-8 text-center space-y-4">
              <div className="text-6xl mb-4">{fanmark.emoji_combination}</div>
              <p className="text-lg font-medium text-foreground">
                {t('common.getYourFanmark')}
              </p>
              <div className="flex justify-center">
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
              </div>
            </CardContent>
          </Card>
        </div>
      );
    
    default:
      return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 flex items-center justify-center">
          <Card className="w-96">
            <CardContent className="p-8 text-center space-y-4">
              <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
              <h1 className="text-xl font-semibold">{t('common.invalidAccessType')}</h1>
              <p className="text-muted-foreground">
                {t('common.invalidConfiguration')}
              </p>
              <Button onClick={() => navigate('/')} className="w-full">
                <Home className="h-4 w-4 mr-2" />
                {t('common.goToHome')}
              </Button>
            </CardContent>
          </Card>
        </div>
      );
  }
};