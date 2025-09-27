import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmojiPicker } from 'frimousse';
import { Plus, X, Eraser, Clipboard, Keyboard } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';

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
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [showDirectInput, setShowDirectInput] = useState<boolean>(false);
  const [directInputText, setDirectInputText] = useState<string>('');

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

  const isEmojiOnly = useCallback(
    (text: string) => {
      if (!text) return true;

      // More comprehensive emoji validation
      const emojiOnlyRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}][\p{Emoji_Modifier}\p{Variation_Selector}\p{Emoji_Modifier_Base}\p{Emoji_Component}]*|[\p{Regional_Indicator}]{2}$/u;
      const segments = splitGraphemes(text);

      return segments.every(segment => {
        // Check if each segment is a valid emoji
        return emojiOnlyRegex.test(segment) || /^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(segment);
      });
    },
    [splitGraphemes]
  );

  const extractEmojis = useCallback(
    (text: string) => {
      if (!text) return [];

      const segments = splitGraphemes(text);
      const emojiSegments: string[] = [];

      // More comprehensive emoji detection regex
      const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}][\p{Emoji_Modifier}\p{Variation_Selector}\p{Emoji_Modifier_Base}\p{Emoji_Component}]*|[\u{1F1E6}-\u{1F1FF}]{2}/u;

      segments.forEach(segment => {
        // Check if this segment is an emoji
        if (emojiRegex.test(segment)) {
          emojiSegments.push(segment);
        }
      });

      return emojiSegments;
    },
    [splitGraphemes]
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

      // Extract emojis from the clipboard content
      const extractedEmojis = extractEmojis(clipboardText);

      if (extractedEmojis.length === 0) {
        toast({
          title: t('common.noEmojisFound'),
          description: t('common.noEmojisFoundDesc'),
        });
        return;
      }

      // Limit to maxLength
      const limitedEmojis = extractedEmojis.slice(0, maxLength);
      const wasEmojiOnly = isEmojiOnly(clipboardText);

      // Determine appropriate message
      let title = '貼り付け完了';
      let description = '';

      if (!wasEmojiOnly && limitedEmojis.length > 0) {
        if (extractedEmojis.length > maxLength) {
          // Extracted emojis + truncated
          title = '絵文字を抽出して貼り付けました';
          description = `${extractedEmojis.length}個の絵文字を見つけて、先頭${maxLength}個を貼り付けました`;
        } else {
          // Only extracted emojis
          title = '絵文字を抽出して貼り付けました';
          description = `${limitedEmojis.length}個の絵文字を抽出しました`;
        }
      } else if (wasEmojiOnly) {
        if (extractedEmojis.length > maxLength) {
          // Pure emojis + truncated
          title = '文字数を調整しました';
          description = `先頭${maxLength}個の絵文字を貼り付けました`;
        } else {
          // Pure emojis, no truncation
          description = `${limitedEmojis.length}個の絵文字を貼り付けました`;
        }
      }

      toast({
        title,
        description,
      });

      updateValue(limitedEmojis);
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
    setDirectInputText('');
    setShowDirectInput(true);
  };

  const handleDirectInputConfirm = () => {
    if (!directInputText.trim()) {
      setShowDirectInput(false);
      return;
    }

    // Extract emojis from the input text
    const extractedEmojis = extractEmojis(directInputText);

    if (extractedEmojis.length === 0) {
      toast({
        title: t('common.noEmojisFound'),
        description: t('common.noEmojisFoundDesc'),
      });
      return;
    }

    // Limit to maxLength
    const limitedEmojis = extractedEmojis.slice(0, maxLength);
    const wasEmojiOnly = isEmojiOnly(directInputText);

    // Determine appropriate message
    let title = '入力完了';
    let description = '';

    if (!wasEmojiOnly && limitedEmojis.length > 0) {
      if (extractedEmojis.length > maxLength) {
        // Extracted emojis + truncated
        title = '絵文字を抽出しました';
        description = `${extractedEmojis.length}個の絵文字を見つけて、先頭${maxLength}個を入力しました`;
      } else {
        // Only extracted emojis
        title = '絵文字を抽出しました';
        description = `${limitedEmojis.length}個の絵文字を抽出しました`;
      }
    } else if (wasEmojiOnly) {
      if (extractedEmojis.length > maxLength) {
        // Pure emojis + truncated
        title = '文字数を調整しました';
        description = `先頭${maxLength}個の絵文字を入力しました`;
      } else {
        // Pure emojis, no truncation
        description = `${limitedEmojis.length}個の絵文字を入力しました`;
      }
    }

    toast({
      title,
      description,
    });

    updateValue(limitedEmojis);
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
    <div className={`w-full ${showUtilities ? 'space-y-0.5 sm:space-y-3' : ''} ${className}`}>
      {/* メイン入力エリア */}
      <div className="flex justify-center">
        <div className="flex gap-1 sm:gap-4 transition-all duration-300 ease-out max-w-fit">
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
              className={`flex h-14 w-14 sm:h-20 sm:w-20 items-center justify-center rounded-2xl border text-2xl sm:text-4xl transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${emoji ? 'border-primary/40 bg-primary/5' : 'border-dashed border-primary/20 text-muted-foreground hover:border-primary/40 hover:text-primary'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${isDragging ? 'ring-2 ring-primary/50 scale-105 shadow-lg z-10 opacity-80' : ''} ${isDragTarget && !isDragging ? 'border-primary/60 bg-primary/10 scale-105' : ''}`}
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
              {emoji ? emoji : <Plus className="h-5 w-5 sm:h-8 sm:w-8" />}
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
      </div>

      {/* 便利ツール */}
      {showUtilities && (
        <div className="flex justify-center">
          <div className="flex items-center gap-1 sm:gap-3 rounded-full bg-muted/30 px-2 sm:px-4 py-1.5 sm:py-2 border border-primary/10 max-w-fit">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleDirectInput}
              aria-label={language === 'ja' ? '直接入力' : 'Direct Input'}
              className="h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"
            >
              <Keyboard className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline text-xs">{language === 'ja' ? '直接入力' : 'Type'}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handlePaste}
              aria-label={t('common.pasteFromClipboard')}
              className="h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"
            >
              <Clipboard className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline text-xs">{language === 'ja' ? '貼り付け' : 'Paste'}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || !hasValue}
              onClick={handleClear}
              aria-label={t('common.clearAll')}
              className="h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"
            >
              <Eraser className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline text-xs">{language === 'ja' ? 'クリア' : 'Clear'}</span>
            </Button>
          </div>
        </div>
      )}

      {/* 直接入力モーダル */}
      <Dialog open={showDirectInput} onOpenChange={setShowDirectInput}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {language === 'ja' ? '絵文字を直接入力' : 'Direct Emoji Input'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {language === 'ja'
                  ? '絵文字を含む文字を入力してください。絵文字のみが抽出されます。'
                  : 'Enter text containing emojis. Only emojis will be extracted.'}
              </p>
              <Input
                value={directInputText}
                onChange={(e) => setDirectInputText(e.target.value)}
                placeholder={language === 'ja' ? 'ここに入力してください...' : 'Type here...'}
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
                {language === 'ja' ? 'キャンセル' : 'Cancel'}
              </Button>
              <Button
                onClick={handleDirectInputConfirm}
                disabled={!directInputText.trim()}
                className="px-4"
              >
                {language === 'ja' ? '確定' : 'Confirm'}
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
  language: string;
  t: (key: string) => string;
}

export const EmojiInputUtilities: React.FC<EmojiInputUtilitiesProps> = ({
  disabled = false,
  hasValue,
  onPaste,
  onClear,
  onDirectInput,
  language,
  t,
}) => {
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
      <div className="flex justify-center">
        <div className="flex items-center gap-1 sm:gap-3 rounded-full bg-muted/30 px-2 sm:px-4 py-1.5 sm:py-2 border border-primary/10 max-w-fit">
          {onDirectInput && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleDirectInputClick}
              aria-label={language === 'ja' ? '直接入力' : 'Direct Input'}
              className="h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"
            >
              <Keyboard className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline text-xs">{language === 'ja' ? '直接入力' : 'Type'}</span>
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
            <span className="hidden sm:inline text-xs">{language === 'ja' ? '貼り付け' : 'Paste'}</span>
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
            <span className="hidden sm:inline text-xs">{language === 'ja' ? 'クリア' : 'Clear'}</span>
          </Button>
        </div>
      </div>

      {/* 直接入力モーダル */}
      <Dialog open={showDirectInput} onOpenChange={setShowDirectInput}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {language === 'ja' ? '絵文字を直接入力' : 'Direct Emoji Input'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {language === 'ja'
                  ? '絵文字を含む文字を入力してください。絵文字のみが抽出されます。'
                  : 'Enter text containing emojis. Only emojis will be extracted.'}
              </p>
              <Input
                value={directInputText}
                onChange={(e) => setDirectInputText(e.target.value)}
                placeholder={language === 'ja' ? 'ここに入力してください...' : 'Type here...'}
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
                {language === 'ja' ? 'キャンセル' : 'Cancel'}
              </Button>
              <Button
                onClick={handleDirectInputConfirm}
                disabled={!directInputText.trim()}
                className="px-4"
              >
                {language === 'ja' ? '確定' : 'Confirm'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
