import React from 'react';
import { EmojiPicker } from 'frimousse';
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
  const { language } = useTranslation();
  const isMobile = useIsMobile();

  const handleEmojiSelect = (emoji: { emoji: string; label: string }) => {
    onEmojiSelect(emoji.emoji);
  };

  const pickerWidth = width || (isMobile ? 280 : 320);
  const pickerHeight = height || (isMobile ? 300 : 400);

  return (
    <div 
      className={`${disabled ? 'opacity-50 pointer-events-none' : ''} bg-card text-card-foreground border border-border rounded-md overflow-hidden`}
      style={{ width: pickerWidth, height: pickerHeight }}
    >
      <EmojiPicker.Root
        onEmojiSelect={handleEmojiSelect}
        className="w-full h-full"
      >
        <div className="p-2 border-b border-border">
          <EmojiPicker.Search 
            placeholder={language === 'ja' ? '絵文字を検索...' : 'Search emojis...'}
            className="w-full px-3 py-2 bg-muted border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <EmojiPicker.Viewport className="flex-1 overflow-auto">
          <EmojiPicker.Loading className="flex items-center justify-center h-20 text-muted-foreground">
            {language === 'ja' ? '読み込み中...' : 'Loading...'}
          </EmojiPicker.Loading>
          <EmojiPicker.Empty className="flex items-center justify-center h-20 text-muted-foreground">
            {language === 'ja' ? '絵文字が見つかりません' : 'No emoji found.'}
          </EmojiPicker.Empty>
          <EmojiPicker.List className="grid grid-cols-8 gap-1 p-2" />
        </EmojiPicker.Viewport>
      </EmojiPicker.Root>
    </div>
  );
};