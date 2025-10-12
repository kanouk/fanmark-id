import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmojiPicker } from 'frimousse';
import { Plus, X, Eraser, Clipboard, Keyboard } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import {
  segmentEmojiSequence,
  convertEmojiSequenceToIdPair,
  convertEmojiIdsToSequence,
  canonicalizeEmojiString,
} from '@/lib/emojiConversion';

const normalizeInput = (text: string) => {
  if (!text) return '';

  return canonicalizeEmojiString(text);
};

interface EmojiInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  onSearchPerformed?: (query: string) => void;
  showUtilities?: boolean;
}

const DEFAULT_MAX_LENGTH = 5;

export const EmojiInput: React.FC<EmojiInputProps> = ({
  value,
  onChange,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
  className = '',
  onSearchPerformed,
  showUtilities = true,
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [showDirectInput, setShowDirectInput] = useState<boolean>(false);
  const [directInputText, setDirectInputText] = useState<string>('');
  const lastValidSegmentsRef = useRef<string[]>([]);

  const segmentInput = useCallback((text: string) => {
    if (!text) return [] as string[];

    try {
      const normalized = normalizeInput(text);
      const segments = segmentEmojiSequence(normalized);
      if (process.env.NODE_ENV === 'development') {
        console.log('[EmojiInput] segmentInput marker');
        console.log('[EmojiInput] segmentInput', {
          text,
          normalized,
          segments,
        });
      }
      return segments;
    } catch (error) {
      console.error('Failed to segment input text:', error);
      return [];
    }
  }, []);

  const splitGraphemes = useCallback(
    (text: string) => {
      if (!text) return [] as string[];

      if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
        const segmenter = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
        return Array.from(segmenter.segment(text), (segment: any) => segment.segment);
      }

      return segmentInput(text);
    },
    [segmentInput]
  );

  const isEmojiOnly = useCallback(
    (text: string) => {
      if (!text.trim()) return true;

      const normalizedText = normalizeInput(text);
      const segments = segmentInput(normalizedText);
      if (segments.length === 0) {
        return false;
      }

      const joined = segments.join('');

      try {
        convertEmojiSequenceToIdPair(joined);
        return true;
      } catch {
        return false;
      }
    },
    [segmentInput]
  );

  const segments = useMemo(() => {
    const segmented = segmentInput(value);
    if (segmented.length > 0) {
      return segmented.slice(0, maxLength);
    }

    const graphemes = splitGraphemes(value);
    if (graphemes.length > maxLength) {
      return graphemes.slice(0, maxLength);
    }
    return graphemes;
  }, [segmentInput, splitGraphemes, value, maxLength]);


  const updateValue = useCallback(
    (newSegments: string[]) => {
      const trimmed = newSegments.slice(0, maxLength);
      const nextValue = normalizeInput(trimmed.join(''));

      onChange(nextValue);
      onSearchPerformed?.(nextValue);
      if (nextValue) {
        lastValidSegmentsRef.current = segmentInput(nextValue);
      } else {
        lastValidSegmentsRef.current = [];
      }
    },
    [onChange, onSearchPerformed, maxLength, segmentInput]
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

  const handlePaste = async () => {
    if (disabled) return;

    try {
      // Check if clipboard API is available
      if (!navigator.clipboard) {
        toast({
          title: t('common.error'),
          description: t('common.clipboardNotSupported'),
          variant: 'destructive',
        });
        return;
      }

      const clipboardText = await navigator.clipboard.readText();

      if (!clipboardText.trim()) {
        toast({
          title: t('common.error'),
          description: t('common.clipboardEmpty'),
          variant: 'destructive',
        });
        return;
      }

      const sanitized = normalizeInput(clipboardText);
      if (!sanitized) {
        toast({
          title: t('common.noEmojisFound'),
          description: t('common.noEmojisFoundDesc'),
        });
        return;
      }

      const wasEmojiOnly = isEmojiOnly(sanitized);
      let segments = segmentInput(sanitized);
      if (process.env.NODE_ENV === 'development') {
        console.log('[EmojiInput] handlePaste', { sanitized, wasEmojiOnly, segments });
      }

      if (segments.length === 0) {
        toast({
          title: t('common.noEmojisFound'),
          description: t('common.noEmojisFoundDesc'),
        });
        return;
      }

      const canonicalSequence = normalizeInput(segments.join(''));
      const canonicalSegments = segmentInput(canonicalSequence);
      const canonicalCount = canonicalSegments.length;
      if (process.env.NODE_ENV === 'development') {
        console.log('[EmojiInput] handlePaste canonical count', { canonicalCount, canonicalSegments });
      }

      const limitedSegments = canonicalSegments.slice(0, maxLength);
      const limitedValue = limitedSegments.join('');
      if (process.env.NODE_ENV === 'development') {
        console.log('[EmojiInput] handlePaste limited', { limitedSegments, limitedValue });
      }

      let wasTruncated = false;
      if (canonicalCount > limitedSegments.length) {
        wasTruncated = true;
      }

      const limitedPair = convertEmojiSequenceToIdPair(limitedValue);
      if (process.env.NODE_ENV === 'development') {
        console.log('[EmojiInput] handlePaste limited conversion', { limitedValue, limitedPair });
      }

      // Determine appropriate message
      const title = '貼り付け完了';
      const description = '絵文字を貼り付けました';

      toast({
        title,
        description,
      });

      updateValue(limitedSegments);
      setActiveIndex(null);

    } catch (error) {
      console.error('Paste failed:', error);
      toast({
        title: t('common.error'),
        description: t('common.clipboardReadFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleDirectInput = () => {
    if (disabled) return;
    setDirectInputText(value);
    setShowDirectInput(true);
  };

  const handleDirectInputConfirm = () => {
    if (!directInputText.trim()) {
      setShowDirectInput(false);
      return;
    }

    const sanitized = normalizeInput(directInputText);
    if (!sanitized) {
      toast({
        title: t('common.noEmojisFound'),
        description: t('common.noEmojisFoundDesc'),
      });
      return;
    }

    const wasEmojiOnly = isEmojiOnly(sanitized);

    let segments = segmentInput(sanitized);
    if (process.env.NODE_ENV === 'development') {
      console.log('[EmojiInput] handleDirectInputConfirm', { sanitized, wasEmojiOnly, segments });
    }

    if (segments.length === 0) {
      toast({
        title: t('common.noEmojisFound'),
        description: t('common.noEmojisFoundDesc'),
      });
      return;
    }

    const canonicalSequence = normalizeInput(segments.join(''));
    const canonicalSegments = segmentInput(canonicalSequence);
    const canonicalCount = canonicalSegments.length;
    if (process.env.NODE_ENV === 'development') {
      console.log('[EmojiInput] handleDirectInputConfirm canonical count', { canonicalCount, canonicalSegments });
    }

    const limitedSegments = canonicalSegments.slice(0, maxLength);
    const limitedValue = limitedSegments.join('');
    if (process.env.NODE_ENV === 'development') {
      console.log('[EmojiInput] handleDirectInputConfirm limited', { limitedSegments, limitedValue });
    }

    let wasTruncated = false;
    if (canonicalCount > limitedSegments.length) {
      wasTruncated = true;
    }

    const limitedPair = convertEmojiSequenceToIdPair(limitedValue);
    if (process.env.NODE_ENV === 'development') {
      console.log('[EmojiInput] handleDirectInputConfirm limited conversion', { limitedValue, limitedPair });
    }

    // Determine appropriate message
    const title = '入力完了';
    const description = '絵文字を入力しました';

    toast({
      title,
      description,
    });

    updateValue(limitedSegments);
    setShowDirectInput(false);
    setDirectInputText('');
  };

  const handleOpenChange = (index: number, open: boolean) => {
    if (disabled) return;
    setActiveIndex(open ? index : null);
  };

  const maxSlots = Math.min(maxLength, DEFAULT_MAX_LENGTH);
  const slots = Array.from({ length: maxSlots });
  const hasValue = segments.length > 0;

  return (
    <div className={`w-full ${showUtilities ? 'space-y-6 sm:space-y-8' : ''} ${className}`}>
      {/* メイン入力エリア */}
      <div className="flex justify-center">
        <div
          className="w-full max-w-[min(100%,40rem)] px-[clamp(0.75rem,6vw,2.5rem)]"
        >
          <div className="grid grid-cols-5 gap-[clamp(0.45rem,2.5vw,1.2rem)] transition-all duration-300 ease-out">
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
              className={`flex aspect-square w-full min-w-[2.2rem] max-w-[5rem] items-center justify-center rounded-[clamp(1rem,4vw,1.7rem)] border-[clamp(1px,0.45vw,1.5px)] text-[clamp(1.6rem,5.5vw,2.8rem)] transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${emoji ? 'border-primary/60 bg-primary/5 shadow-md lg:shadow-lg' : 'border-dashed border-primary/30 text-muted-foreground hover:border-primary/60 hover:text-primary'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${isDragging ? 'ring-2 ring-primary/50 scale-105 shadow-lg z-10 opacity-80' : ''} ${isDragTarget && !isDragging ? 'border-primary/70 bg-primary/10 scale-105' : ''}`}
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
              {emoji ? emoji : <Plus className="h-[clamp(0.9rem,3.8vw,2rem)] w-[clamp(0.9rem,3.8vw,2rem)]" />}
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
                  className="w-[400px] max-w-[95vw] rounded-2xl border border-border bg-card p-0 shadow-[0_20px_45px_rgba(101,195,200,0.18)]"
                  align="center"
                  side="bottom"
                  sideOffset={8}
                  collisionPadding={20}
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
                    className="flex h-[360px] flex-col w-full overflow-hidden"
                  >
                    <div className="border-b border-border/70 bg-background/80 px-4 pt-4 pb-3 backdrop-blur">
                      <EmojiPicker.Search
                        placeholder={t('common.searchEmojis')}
                        className="w-full rounded-full border border-border/50 bg-muted/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <EmojiPicker.Viewport className="flex-1 overflow-auto">
                      <EmojiPicker.Loading className="flex h-24 items-center justify-center text-muted-foreground">
                        {t('common.loading')}
                      </EmojiPicker.Loading>
                      <EmojiPicker.Empty className="flex h-24 items-center justify-center text-muted-foreground">
                        {t('common.noEmojiFound')}
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
        </div>
      </div>

      {/* 便利ツール */}
      {showUtilities && (
        <div className="flex justify-center mt-[clamp(1.2rem,4vw,1.8rem)] sm:mt-6">
          <div className="flex items-center gap-[clamp(0.35rem,2vw,0.9rem)] sm:gap-3 rounded-full bg-muted/30 px-[clamp(0.7rem,3.5vw,1rem)] sm:px-4 py-[clamp(0.6rem,2.5vw,0.9rem)] sm:py-2.5 border border-primary/20 max-w-fit shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleDirectInput}
              aria-label={t('common.directInput')}
              className="h-[clamp(2.2rem,7vw,2.6rem)] sm:h-8 px-[clamp(0.5rem,2vw,0.8rem)] sm:px-3 rounded-full text-[clamp(0.65rem,2.3vw,0.8rem)] font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-[clamp(0.35rem,1.6vw,0.6rem)] sm:gap-1.5"
            >
              <Keyboard className="h-[clamp(0.85rem,3vw,1rem)] w-[clamp(0.85rem,3vw,1rem)] sm:h-3.5 sm:w-3.5" />
              <span className="text-[clamp(0.65rem,2.3vw,0.8rem)]">{t('common.directInput')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handlePaste}
              aria-label={t('common.pasteFromClipboard')}
              className="h-[clamp(2.2rem,7vw,2.6rem)] sm:h-8 px-[clamp(0.5rem,2vw,0.8rem)] sm:px-3 rounded-full text-[clamp(0.65rem,2.3vw,0.8rem)] font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-[clamp(0.35rem,1.6vw,0.6rem)] sm:gap-1.5"
            >
              <Clipboard className="h-[clamp(0.85rem,3vw,1rem)] w-[clamp(0.85rem,3vw,1rem)] sm:h-3.5 sm:w-3.5" />
              <span className="text-[clamp(0.65rem,2.3vw,0.8rem)]">{t('common.paste')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || !hasValue}
              onClick={handleClear}
              aria-label={t('common.clearAll')}
              className="h-[clamp(2.2rem,7vw,2.6rem)] sm:h-8 px-[clamp(0.5rem,2vw,0.8rem)] sm:px-3 rounded-full text-[clamp(0.65rem,2.3vw,0.8rem)] font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-[clamp(0.35rem,1.6vw,0.6rem)] sm:gap-1.5"
            >
              <Eraser className="h-[clamp(0.85rem,3vw,1rem)] w-[clamp(0.85rem,3vw,1rem)] sm:h-3.5 sm:w-3.5" />
              <span className="text-[clamp(0.65rem,2.3vw,0.8rem)]">{t('common.clear')}</span>
            </Button>
          </div>
        </div>
      )}

      {/* 直接入力モーダル */}
      <Dialog open={showDirectInput} onOpenChange={setShowDirectInput}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {t('common.directInput')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t('common.directInputDescription')}
              </p>
              <Input
                value={directInputText}
                onChange={(e) => setDirectInputText(e.target.value)}
                placeholder={t('common.directInputPlaceholder')}
                className="text-base"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleDirectInputConfirm();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDirectInput(false)}
                className="px-4"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleDirectInputConfirm}
                disabled={!directInputText.trim()}
                className="px-4"
              >
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Separate utilities component for flexible positioning
interface EmojiInputUtilitiesProps {
  disabled?: boolean;
  hasValue: boolean;
  onPaste: () => void;
  onClear: () => void;
  onDirectInput?: (input: string) => void;
}

export const EmojiInputUtilities: React.FC<EmojiInputUtilitiesProps> = ({
  disabled = false,
  hasValue,
  onPaste,
  onClear,
  onDirectInput,
}) => {
  const { t } = useTranslation();
  const [showDirectInput, setShowDirectInput] = useState<boolean>(false);
  const [directInputText, setDirectInputText] = useState<string>('');

  const handleDirectInputClick = () => {
    if (disabled || !onDirectInput) return;
    setDirectInputText('');
    setShowDirectInput(true);
  };

  const handleDirectInputConfirm = () => {
    if (!directInputText.trim()) {
      setShowDirectInput(false);
      return;
    }

    onDirectInput?.(directInputText);
    setShowDirectInput(false);
    setDirectInputText('');
  };

  return (
    <>
        <div className="flex justify-center mt-5 sm:mt-6">
          <div className="flex items-center gap-1 sm:gap-3 rounded-full bg-muted/30 px-3 sm:px-4 py-2 sm:py-2.5 border border-primary/20 max-w-fit shadow-sm">
          {onDirectInput && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleDirectInputClick}
              aria-label={t('common.directInput')}
              className="h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"
            >
              <Keyboard className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="text-xs">{t('common.directInput')}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onPaste}
            aria-label={t('common.pasteFromClipboard')}
            className="h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"
          >
            <Clipboard className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span className="text-xs">{t('common.paste')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || !hasValue}
            onClick={onClear}
            aria-label={t('common.clearAll')}
            className="h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"
          >
            <Eraser className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span className="text-xs">{t('common.clear')}</span>
          </Button>
        </div>
      </div>

      {/* 直接入力モーダル */}
      <Dialog open={showDirectInput} onOpenChange={setShowDirectInput}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {t('common.directInput')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t('common.directInputDescription')}
              </p>
              <Input
                value={directInputText}
                onChange={(e) => setDirectInputText(e.target.value)}
                placeholder={t('common.directInputPlaceholder')}
                className="text-base"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleDirectInputConfirm();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDirectInput(false)}
                className="px-4"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleDirectInputConfirm}
                disabled={!directInputText.trim()}
                className="px-4"
              >
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
