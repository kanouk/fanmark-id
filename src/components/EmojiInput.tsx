import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EmojiPicker } from 'frimousse';
import { Sparkles, Plus, X, Eraser } from 'lucide-react';
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

const DEFAULT_MAX_LENGTH = 5;

export const EmojiInput: React.FC<EmojiInputProps> = ({
  value,
  onChange,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
  className = '',
  onSearchPerformed,
}) => {
  const { t, language } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const segmenter = useMemo(() => {
    if (typeof Intl === 'undefined' || !(Intl as any).Segmenter) {
      return null;
    }
    try {
      return new (Intl as any).Segmenter(language, { granularity: 'grapheme' });
    } catch (error) {
      console.warn('Failed to create Intl.Segmenter:', error);
      return null;
    }
  }, [language]);

  const splitGraphemes = useCallback(
    (text: string) => {
      if (!text) return [] as string[];
      if (segmenter) {
        return Array.from(segmenter.segment(text), (segment: any) => segment.segment as string);
      }
      return Array.from(text);
    },
    [segmenter]
  );

  const segments = useMemo(() => {
    const graphemes = splitGraphemes(value);
    if (graphemes.length > maxLength) {
      return graphemes.slice(0, maxLength);
    }
    return graphemes;
  }, [splitGraphemes, value, maxLength]);


  const updateValue = useCallback(
    (newSegments: string[]) => {
      const trimmed = newSegments.slice(0, maxLength);
      const nextValue = trimmed.join('');
      onChange(nextValue);
      onSearchPerformed?.(nextValue);
    },
    [onChange, onSearchPerformed, maxLength]
  );

  const handleSelect = (index: number, emoji: string) => {
    if (disabled) return;
    const newSegments = [...segments];
    const targetIndex = Math.min(index, newSegments.length);
    if (targetIndex < newSegments.length) {
      newSegments[targetIndex] = emoji;
    } else {
      newSegments.push(emoji);
    }
    updateValue(newSegments);
    setActiveIndex(null);
  };

  const handleRemove = (index: number) => {
    if (disabled) return;
    const newSegments = segments.filter((_, i) => i !== index);
    updateValue(newSegments);
    if (activeIndex === index) {
      setActiveIndex(null);
    }
  };

  const handleClear = () => {
    if (disabled || segments.length === 0) return;
    updateValue([]);
    setActiveIndex(null);
  };

  const handleOpenChange = (index: number, open: boolean) => {
    if (disabled) return;
    setActiveIndex(open ? index : null);
  };

  const maxSlots = Math.min(maxLength, DEFAULT_MAX_LENGTH);
  const slots = Array.from({ length: maxSlots });
  const hasValue = segments.length > 0;

  return (
    <div className={`flex w-full items-center gap-4 ${className}`}>
      <div className="flex flex-1" />
      <div className="flex flex-wrap justify-center gap-3">
        {slots.map((_, index) => {
          const emoji = segments[index];
          const isActive = activeIndex === index;

          const triggerButton = (
            <button
              type="button"
              disabled={disabled}
              onClick={() => handleOpenChange(index, true)}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl border text-2xl transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${emoji ? 'border-primary/40 bg-primary/5' : 'border-dashed border-primary/20 text-muted-foreground hover:border-primary/40 hover:text-primary'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              {emoji ? emoji : <Plus className="h-5 w-5" />}
            </button>
          );

          return (
            <div key={index} className="group relative">
              <Popover
                open={isActive}
                onOpenChange={(open) => handleOpenChange(index, open)}
              >
                <PopoverTrigger asChild>
                  {triggerButton}
                </PopoverTrigger>
                <PopoverContent
                  className="w-[360px] max-w-[90vw] rounded-2xl border border-border bg-card p-0 shadow-[0_20px_45px_rgba(101,195,200,0.18)]"
                  align="start"
                  side="bottom"
                  sideOffset={8}
                  collisionPadding={16}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <EmojiPicker.Root
                    onEmojiSelect={(emoji: { emoji: string } | string) => {
                      const selected = typeof emoji === 'string' ? emoji : emoji?.emoji;
                      if (selected) {
                        handleSelect(index, selected);
                      }
                    }}
                    className="flex h-[360px] flex-col"
                  >
                    <div className="border-b border-border/70 bg-background/80 px-4 pt-4 pb-3 backdrop-blur">
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

              {emoji && !disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="absolute -top-2 -right-2 hidden h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition hover:scale-105 group-hover:flex"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-1 justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || !hasValue}
          onClick={handleClear}
          aria-label={t('common.clearAll')}
          className="h-10 w-10 rounded-full border border-primary/20 text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        >
          <Eraser className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('common.aiRecommendationComingSoon')}
          title={t('common.aiRecommendationDescription')}
          disabled
          className="h-10 w-10 rounded-full border border-primary/20 text-primary"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
