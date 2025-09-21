import React from 'react';
import EmojiPicker, { EmojiClickData, Theme, EmojiStyle } from 'emoji-picker-react';
import { useTheme } from 'next-themes';
import { useTranslation } from '@/hooks/useTranslation';

interface CustomEmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  disabled?: boolean;
}

export const CustomEmojiPicker: React.FC<CustomEmojiPickerProps> = ({
  onEmojiSelect,
  disabled = false
}) => {
  const { resolvedTheme } = useTheme();
  const { t, language } = useTranslation();

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onEmojiSelect(emojiData.emoji);
  };

  return (
    <div className={disabled ? 'opacity-50 pointer-events-none' : ''}>
      <EmojiPicker
        onEmojiClick={handleEmojiClick}
        theme={resolvedTheme === 'dark' ? Theme.DARK : Theme.LIGHT}
        width={320}
        height={400}
        previewConfig={{
          showPreview: true
        }}
        searchPlaceHolder={language === 'ja' ? '絵文字を検索...' : 'Search emojis...'}
        skinTonesDisabled={false}
        emojiStyle={EmojiStyle.NATIVE}
        lazyLoadEmojis={true}
        style={{
          '--epr-bg-color': 'oklch(var(--b1))',
          '--epr-text-color': 'oklch(var(--bc))',
          '--epr-border-color': 'oklch(var(--b3))',
          '--epr-highlight-color': 'oklch(var(--p))',
          '--epr-hover-bg-color': 'oklch(var(--b2))',
          '--epr-focus-bg-color': 'oklch(var(--b2))',
          '--epr-search-bg-color': 'oklch(var(--b2))',
          '--epr-category-icon-active-color': 'oklch(var(--p))',
          '--epr-skin-tone-picker-menu-color': 'oklch(var(--b1))'
        } as React.CSSProperties}
      />
    </div>
  );
};