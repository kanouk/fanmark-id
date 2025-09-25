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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);

  const splitGraphemes = useCallback(
    (text: string) => {
      if (!text) return [] as string[];
      
      // Use Intl.Segmenter for accurate grapheme cluster splitting if available
      if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
        const segmenter = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
        return Array.from(segmenter.segment(text), (segment: any) => segment.segment);
      }
      
      // Fallback: Advanced regex for complex emoji support
      // This regex handles:
      // - Extended pictographic characters (most emojis)
      // - Skin tone modifiers
      // - Variation selectors (like ️)
      // - Zero-width joiners for compound emojis
      // - Regional indicator symbols for flags
      const complexEmojiRegex = /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}))*|\p{Regional_Indicator}{2}|./gu;
      return text.match(complexEmojiRegex) || [];
    },
    []
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

  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;

      setIsAnimating(true);

      // Smooth animation delay before reordering
      setTimeout(() => {
        const currentSegments = [...segments];
        const [movedEmoji] = currentSegments.splice(fromIndex, 1);
        if (!movedEmoji) {
          setIsAnimating(false);
          return;
        }
        const clampedIndex = Math.min(toIndex, currentSegments.length);
        currentSegments.splice(clampedIndex, 0, movedEmoji);
        updateValue(currentSegments);
        setActiveIndex(null);

        // Reset animation state after reorder completes
        setTimeout(() => {
          setIsAnimating(false);
        }, 150);
      }, 0);
    },
    [segments, updateValue]
  );

  const handleDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, index: number) => {
    if (disabled || !segments[index]) {
      event.preventDefault();
      return;
    }
    setDraggedIndex(index);
    setDragOverIndex(index);
    setIsDragging(true);
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    } catch (error) {
      // dataTransfer might not be available in some environments; ignore
    }
    setActiveIndex(null);
  }, [disabled, segments]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    event.preventDefault();
    try {
      event.dataTransfer.dropEffect = 'move';
    } catch (error) {
      // Ignore if dropEffect is not supported
    }
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  }, [disabled, dragOverIndex]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    event.preventDefault();
    const storedIndex = (() => {
      if (draggedIndex !== null) return draggedIndex;
      const data = event.dataTransfer.getData('text/plain');
      const parsed = Number.parseInt(data, 10);
      return Number.isInteger(parsed) ? parsed : null;
    })();

    if (storedIndex === null || storedIndex === index) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    handleReorder(storedIndex, index);
    setDraggedIndex(null);
    setDragOverIndex(null);
    setIsDragging(false);
  }, [disabled, draggedIndex, handleReorder]);

  const handleDragLeave = useCallback((index: number) => {
    setDragOverIndex((current) => (current === index ? null : current));
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    setIsDragging(false);

    // Clear animation state after a brief delay
    setTimeout(() => {
      setIsAnimating(false);
    }, 200);
  }, []);

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
    <div className={`flex w-full items-center gap-2 sm:gap-5 ${className}`}>
      <div className="flex flex-1" />
      <div className="flex flex-wrap justify-center gap-2 sm:gap-4 transition-all duration-300 ease-out">
        {slots.map((_, index) => {
          const emoji = segments[index];
          const isActive = activeIndex === index;

          const isDragging = draggedIndex === index;
          const isDragTarget = dragOverIndex === index;

          const triggerButton = (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (draggedIndex !== null) return;
                handleOpenChange(index, true);
              }}
              className={`flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-2xl border text-2xl sm:text-4xl transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${emoji ? 'border-primary/40 bg-primary/5' : 'border-dashed border-primary/20 text-muted-foreground hover:border-primary/40 hover:text-primary'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${isDragging ? 'ring-2 ring-primary/50 scale-105 shadow-lg z-10 opacity-80' : ''} ${isDragTarget && !isDragging ? 'border-primary/60 bg-primary/10 scale-105' : ''}`}
              style={{
                zIndex: isDragging ? 10 : 1,
              }}
              draggable={!disabled && Boolean(emoji)}
              onDragStart={(event) => handleDragStart(event, index)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={(event) => handleDrop(event, index)}
              onDragLeave={() => handleDragLeave(index)}
              onDragEnd={handleDragEnd}
            >
              {emoji ? emoji : <Plus className="h-5 w-5 sm:h-7 sm:w-7" />}
            </button>
          );

          return (
            <div key={index} className="group relative transition-all duration-200 ease-out">
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

              {emoji && !disabled && !isDragging && (
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="absolute -top-1 -right-1 sm:-top-2 sm:-right-2 hidden h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition hover:scale-105 group-hover:flex"
                >
                  <X className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-1 justify-end gap-2 sm:gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || !hasValue}
          onClick={handleClear}
          aria-label={t('common.clearAll')}
          className="h-10 w-10 sm:h-12 sm:w-12 rounded-full border border-primary/20 text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        >
          <Eraser className="h-4 w-4 sm:h-5 sm:w-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('common.aiRecommendationComingSoon')}
          title={t('common.aiRecommendationDescription')}
          disabled
          className="h-10 w-10 sm:h-12 sm:w-12 rounded-full border border-primary/20 text-primary"
        >
          <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
        </Button>
      </div>
    </div>
  );
};
