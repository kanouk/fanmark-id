import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useImeAwareSubmit } from '@/hooks/useImeAwareSubmit';
import { useTranslation } from '@/hooks/useTranslation';
import { EmojiPicker } from 'frimousse';
import { Clipboard, Eraser, Keyboard, Plus, X } from 'lucide-react';
import React,{ useState } from 'react';
import { DEFAULT_MAX_LENGTH, type EmojiInputProps } from './emoji-input/model';
import { useEmojiInputController } from './emoji-input/useEmojiInputController';

export const EmojiInput: React.FC<EmojiInputProps> = ({
  value,
  onChange,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
  className = '',
  onSearchPerformed,
  showUtilities = true,
  fixedSize = false,
}) => {
  const {
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
    handleRemove,
    handleClear,
    handlePaste,
    handleDirectInput,
    handleDirectInputConfirm,
    handleOpenChange,
    slots,
    hasValue,
  } = useEmojiInputController({ value, onChange, disabled, maxLength, className, onSearchPerformed, showUtilities, fixedSize });

  return (
    <div className={`w-full ${showUtilities ? 'space-y-6 sm:space-y-8' : ''} ${className}`}>
      {/* メイン入力エリア */}
      <div className="flex justify-center">
        <div
          className={fixedSize ? "w-full max-w-[48rem] mx-auto px-4" : "w-full max-w-[min(100%,48rem)] px-[clamp(0.75rem,4vw,2rem)]"}
        >
          <div className={fixedSize ? "grid grid-cols-5 gap-6 transition-all duration-300 ease-out" : "grid grid-cols-5 gap-[clamp(1.2rem,5vw,2.5rem)] transition-all duration-300 ease-out"}>
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
              className={`flex aspect-square w-full ${fixedSize ? 'min-w-[4rem] max-w-[5rem] rounded-xl border-[1.5px] text-3xl' : 'min-w-[2.8rem] max-w-[6rem] rounded-[clamp(1rem,4vw,1.7rem)] border-[clamp(1px,0.45vw,1.5px)] text-[clamp(1.8rem,6vw,3.2rem)]'} items-center justify-center transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${emoji ? 'border-primary/60 bg-primary/5 shadow-md lg:shadow-lg' : 'border-dashed border-primary/30 text-muted-foreground hover:border-primary/60 hover:text-primary'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${isDragging ? 'ring-2 ring-primary/50 scale-105 shadow-lg z-10 opacity-80' : ''} ${isDragTarget && !isDragging ? 'border-primary/70 bg-primary/10 scale-105' : ''}`}
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
              {emoji ? emoji : <Plus className={fixedSize ? "h-6 w-6" : "h-[clamp(0.9rem,3.8vw,2rem)] w-[clamp(0.9rem,3.8vw,2rem)]"} />}
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
                  className="absolute top-0 right-0 -translate-y-[20%] translate-x-[20%] sm:-translate-y-[25%] sm:translate-x-[25%] z-10 hidden h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition hover:scale-105 group-hover:flex"
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
                autoFocus
                {...directInputImeHandlers}
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
  onPaste: () => void | boolean | Promise<void | boolean>;
  onClear: () => void;
  onDirectInput?: (input: string) => void;
  value?: string;
  fixedSize?: boolean; // モバイル固定サイズモード
}

export const EmojiInputUtilities: React.FC<EmojiInputUtilitiesProps> = ({
  disabled = false,
  hasValue,
  onPaste,
  onClear,
  onDirectInput,
  value,
  fixedSize = false,
}) => {
  const { t } = useTranslation();
  const [showDirectInput, setShowDirectInput] = useState<boolean>(false);
  const [directInputText, setDirectInputText] = useState<string>('');

  const handleDirectInputClick = () => {
    if (disabled || !onDirectInput) return;
    setDirectInputText(value ?? '');
    setShowDirectInput(true);
  };

  const handlePasteClick = async () => {
    if (disabled) return;

    try {
      const result = await onPaste();
      if (result === false && onDirectInput) {
        setDirectInputText(value ?? '');
        setShowDirectInput(true);
      }
    } catch {
      if (onDirectInput) {
        setDirectInputText(value ?? '');
        setShowDirectInput(true);
      }
    }
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

  const utilitiesImeHandlers = useImeAwareSubmit({
    onSubmit: () => handleDirectInputConfirm(),
    isDisabled: disabled,
  });

  return (
    <>
        <div className={`flex justify-center ${fixedSize ? 'mt-6' : 'mt-5 sm:mt-6'}`}>
          <div className={`flex items-center ${fixedSize ? 'gap-2 px-3 py-2' : 'gap-1 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5'} rounded-full bg-muted/30 border border-primary/20 max-w-fit shadow-sm`}>
          {onDirectInput && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleDirectInputClick}
              aria-label={t('common.directInput')}
              className={fixedSize ? "h-7 px-2 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1" : "h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"}
            >
              <Keyboard className={fixedSize ? "h-3 w-3" : "h-3 w-3 sm:h-3.5 sm:w-3.5"} />
              <span className="text-xs">{t('common.directInput')}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={handlePasteClick}
            aria-label={t('common.pasteFromClipboard')}
            className={fixedSize ? "h-7 px-2 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1" : "h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"}
          >
            <Clipboard className={fixedSize ? "h-3 w-3" : "h-3 w-3 sm:h-3.5 sm:w-3.5"} />
            <span className="text-xs">{t('common.paste')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || !hasValue}
            onClick={onClear}
            aria-label={t('common.clearAll')}
            className={fixedSize ? "h-7 px-2 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1" : "h-7 sm:h-8 px-1.5 sm:px-3 rounded-full text-xs font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-1 sm:gap-1.5"}
          >
            <Eraser className={fixedSize ? "h-3 w-3" : "h-3 w-3 sm:h-3.5 sm:w-3.5"} />
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
                autoFocus
                {...utilitiesImeHandlers}
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
