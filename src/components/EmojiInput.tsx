import React, { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EmojiPicker } from 'frimousse';
import { Smile, Sparkles } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface EmojiInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  onSearchPerformed?: (query: string) => void;
}

export const EmojiInput: React.FC<EmojiInputProps> = ({
  value,
  onChange,
  placeholder,
  disabled = false,
  maxLength = 50,
  className = '',
  onSearchPerformed
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t, language } = useTranslation();

  const handleEmojiSelect = (emoji: string) => {
    const newValue = value + emoji;
    if (newValue.length <= maxLength) {
      onChange(newValue);
      if (onSearchPerformed) {
        onSearchPerformed(newValue);
      }
    }
    // keep picker open and refocus input for continuous entry
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    if (onSearchPerformed && newValue.trim()) {
      onSearchPerformed(newValue);
    }
  };

  const handlePickerOpenChange = (open: boolean) => {
    setIsPickerOpen(open);
  };

  return (
    <div className="w-full flex items-center gap-2">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        className={`${className} flex-1`}
      />
      <Popover open={isPickerOpen} onOpenChange={handlePickerOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={disabled ? t('common.disabled') : t('common.openEmojiPicker')}
            title={disabled ? t('common.disabled') : t('common.openEmojiPicker')}
            disabled={disabled}
          >
            <Smile className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[360px] max-w-[90vw] rounded-2xl border border-border bg-card p-0 shadow-[0_20px_45px_rgba(101,195,200,0.18)]"
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={16}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <EmojiPicker.Root
            onEmojiSelect={(emoji: { emoji: string } | string) => {
              const selected = typeof emoji === 'string'
                ? emoji
                : emoji?.emoji;
              if (selected) {
                handleEmojiSelect(selected);
              }
            }}
            className="flex h-[360px] flex-col"
          >
            <div className="px-4 pt-4 pb-3 border-b border-border/70 bg-background/80 backdrop-blur">
              <EmojiPicker.Search
                placeholder={language === 'ja' ? '絵文字を検索...' : 'Search emojis...'}
                className="w-full rounded-full border border-border/50 bg-muted/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <EmojiPicker.Viewport className="flex-1 overflow-auto">
              <EmojiPicker.Loading className="flex h-24 items-center justify-center text-muted-foreground">
                {language === 'ja' ? '読み込み中...' : 'Loading...'}
              </EmojiPicker.Loading>
              <EmojiPicker.Empty className="flex h-24 items-center justify-center text-muted-foreground">
                {language === 'ja' ? '絵文字が見つかりません' : 'No emoji found.'}
              </EmojiPicker.Empty>
              <EmojiPicker.List className="p-3" />
            </EmojiPicker.Viewport>
          </EmojiPicker.Root>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('common.aiRecommendationComingSoon')}
        title={t('common.aiRecommendationDescription')}
        disabled
      >
        <Sparkles className="h-4 w-4" />
      </Button>
    </div>
  );
};
