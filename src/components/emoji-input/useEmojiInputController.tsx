import { useToast } from '@/hooks/use-toast';
import { useImeAwareSubmit } from '@/hooks/useImeAwareSubmit';
import { useTranslation } from '@/hooks/useTranslation';
import { canonicalizeEmojiString, convertEmojiSequenceToIdPair, extractEmojiString, segmentEmojiSequence } from '@/lib/emojiConversion';
import React,{ useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MAX_LENGTH, type EmojiInputProps } from './model';
import { useEmojiCatalog } from '@/hooks/useEmojiCatalog';
import { requireEmojiCatalog } from '@/lib/emoji-catalog-state';
import { segmentEmojiForDisplay } from '@/lib/emoji-display';

const normalizeInput = (text: string) => {
  if (!text) return '';

  return canonicalizeEmojiString(text);
};

export function useEmojiInputController({
  value,
  onChange,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
  className = '',
  onSearchPerformed,
  showUtilities = true,
  fixedSize = false,
}: EmojiInputProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { ready: catalogReady } = useEmojiCatalog();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [showDirectInput, setShowDirectInput] = useState<boolean>(false);
  const [directInputText, setDirectInputText] = useState<string>('');
  const latestInput = useRef({ value, text: directInputText, open: showDirectInput, activeIndex, alive: true });
  latestInput.current = { ...latestInput.current, value, text: directInputText, open: showDirectInput, activeIndex };
  const pickerRequest = useRef(0);
  useEffect(() => {
    latestInput.current.alive = true;
    return () => { latestInput.current.alive = false; };
  }, []);
  const directInputImeHandlers = useImeAwareSubmit({
    onSubmit: () => handleDirectInputConfirm(),
    isDisabled: disabled,
  });
  const lastValidSegmentsRef = useRef<string[]>([]);
  const isAnimatingInitial = useRef(false);

  useEffect(() => {
    if (!catalogReady) return;
    const canonicalValue = normalizeInput(value);
    if (value && canonicalValue && value !== canonicalValue) {
      onChange(canonicalValue);
    }
  }, [value, onChange, catalogReady]);

  const segmentInput = useCallback((text: string) => {
    if (!text) return [] as string[];
    if (!catalogReady) return segmentEmojiForDisplay(text);

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
  }, [catalogReady]);

  const splitGraphemes = useCallback(
    (text: string) => {
      if (!text) return [] as string[];

      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        return Array.from(segmenter.segment(text), (segment) => segment.segment);
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

  const handleSelect = async (index: number, emoji: string) => {
    if (disabled) return;
    const request = ++pickerRequest.current;
    if (!await requireEmojiCatalog()) return;
    if (!latestInput.current.alive || latestInput.current.value !== value || latestInput.current.activeIndex !== index || request !== pickerRequest.current) return;
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
          title: t('common.clipboardEmptyTitle'),
          description: t('common.clipboardEmptyBody'),
          variant: 'warning',
        });
        return;
      }

      if (!await requireEmojiCatalog()) return;
      if (!latestInput.current.alive || latestInput.current.value !== value) return;
      const extracted = extractEmojiString(clipboardText);
      if (!extracted) {
        toast({
          title: t('common.nonEmojiRejectedTitle'),
          description: t('common.nonEmojiRejectedBody'),
          variant: 'warning',
        });
        return;
      }

      const sanitized = normalizeInput(extracted);
      if (!sanitized) {
        toast({
          title: t('common.noEmojisFound'),
          description: t('common.noEmojisFoundDesc'),
        });
        return;
      }

      const wasEmojiOnly = isEmojiOnly(sanitized);
      const segments = segmentInput(sanitized);
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
      toast({
        title: t('common.pasteCompletedTitle'),
        description: t('common.pasteCompleted'),
      });

      updateValue(limitedSegments);
      setActiveIndex(null);

    } catch (error) {
      console.error('Paste failed:', error);
      setDirectInputText(value);
      setShowDirectInput(true);
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

  const handleDirectInputConfirm = async () => {
    if (!directInputText.trim()) {
      setShowDirectInput(false);
      return;
    }

    if (!await requireEmojiCatalog()) return;
    if (!latestInput.current.alive || !latestInput.current.open || latestInput.current.text !== directInputText) return;
    const extracted = extractEmojiString(directInputText);
    if (!extracted) {
      toast({
        title: t('common.nonEmojiRejectedTitle'),
        description: t('common.nonEmojiRejectedBody'),
        variant: 'warning',
      });
      return;
    }

    const sanitized = normalizeInput(extracted);
    if (!sanitized) {
      toast({
        title: t('common.nonEmojiRejectedTitle'),
        description: t('common.nonEmojiRejectedBody'),
        variant: 'warning',
      });
      return;
    }

    const wasEmojiOnly = isEmojiOnly(sanitized);

    const segments = segmentInput(sanitized);
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

    toast({
      title: t('common.inputCompletedTitle'),
      description: t('common.inputCompleted'),
    });

    updateValue(limitedSegments);
    setShowDirectInput(false);
    setDirectInputText('');
  };

  const handleOpenChange = (index: number, open: boolean) => {
    if (disabled && open) return;
    pickerRequest.current++;
    setActiveIndex(open ? index : null);
  };

  const maxSlots = Math.min(maxLength, DEFAULT_MAX_LENGTH);
  const slots = Array.from({ length: maxSlots });
  const hasValue = segments.length > 0;
  return {
    t,
    activeIndex,
    draggedIndex,
    dragOverIndex,
    isDragging,
    showDirectInput,
    setShowDirectInput,
    directInputText,
    setDirectInputText,
    directInputImeHandlers,
    segments,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragLeave,
    handleDragEnd,
    handleSelect,
    handlePaletteChange: (next: string) => updateValue(segmentInput(next)),
    handleRemove,
    handleClear,
    handlePaste,
    handleDirectInput,
    handleDirectInputConfirm,
    handleOpenChange,
    slots,
    hasValue,
  };
}
