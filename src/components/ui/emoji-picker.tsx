import React from 'react';
import EmojiPicker, { EmojiClickData, Theme, EmojiStyle } from 'emoji-picker-react';
import { useTheme } from 'next-themes';
import { useTranslation } from '@/hooks/useTranslation';
import { useIsMobile } from '@/hooks/use-mobile';

interface CustomEmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  disabled?: boolean;
  width?: number;
  height?: number;
}

export const CustomEmojiPicker: React.FC<CustomEmojiPickerProps> = ({
  onEmojiSelect,
  disabled = false,
  width,
  height
}) => {
  const { resolvedTheme } = useTheme();
  const { t, language } = useTranslation();
  const isMobile = useIsMobile();

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onEmojiSelect(emojiData.emoji);
  };

  const pickerWidth = width || (isMobile ? 280 : 320);
  const pickerHeight = height || (isMobile ? 300 : 400);

  return (
    <div className={disabled ? 'opacity-50 pointer-events-none' : ''}>
      <EmojiPicker
        onEmojiClick={handleEmojiClick}
        theme={resolvedTheme === 'dark' ? Theme.DARK : Theme.LIGHT}
        width={pickerWidth}
        height={pickerHeight}
        previewConfig={{
          showPreview: !isMobile
        }}
        searchPlaceHolder={language === 'ja' ? '絵文字を検索...' : 'Search emojis...'}
        skinTonesDisabled={false}
        emojiStyle={EmojiStyle.NATIVE}
        lazyLoadEmojis={true}
        style={{
          '--epr-bg-color': 'hsl(var(--card))',
          '--epr-text-color': 'hsl(var(--card-foreground))',
          '--epr-border-color': 'hsl(var(--border))',
          '--epr-highlight-color': 'hsl(var(--primary))',
          '--epr-hover-bg-color': 'hsl(var(--muted))',
          '--epr-focus-bg-color': 'hsl(var(--muted))',
          '--epr-search-bg-color': 'hsl(var(--muted))',
          '--epr-category-icon-active-color': 'hsl(var(--primary))',
          '--epr-skin-tone-picker-menu-color': 'hsl(var(--card))'
        } as React.CSSProperties}
      />
    </div>
  );
};