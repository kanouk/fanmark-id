import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { useImeAwareSubmit } from "@/hooks/useImeAwareSubmit";
import { useTranslation } from "@/hooks/useTranslation";

import { Clipboard, Eraser, Keyboard, Plus, X, Undo2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useEmojiCatalog } from "@/hooks/useEmojiCatalog";

import { DEFAULT_MAX_LENGTH, type EmojiInputProps } from "./emoji-input/model";
import { useEmojiInputController } from "./emoji-input/useEmojiInputController";
import { requireEmojiCatalog } from "@/lib/emoji-catalog-state";
import { EmojiCatalogInlineStatus } from "@/components/EmojiCatalogStatus";

export const EmojiInput: React.FC<EmojiInputProps> = ({
  value,
  onChange,
  disabled = false,
  maxLength = DEFAULT_MAX_LENGTH,
  className = "",
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
    handlePaletteChange,
    handleRemove,
    handleClear,
    handlePaste,
    handleDirectInput,
    handleDirectInputConfirm,
    handleOpenChange,
    slots,
    hasValue,
  } = useEmojiInputController({
    value,
    onChange,
    disabled,
    maxLength,
    className,
    onSearchPerformed,
    showUtilities,
    fixedSize,
  });

  const { language } = useTranslation();
  const paletteFailure = {
    ja: "パレットを読み込めませんでした。入力内容はそのままです。",
    en: "The palette could not be loaded. Your input is kept.",
    ko: "팔레트를 불러오지 못했습니다. 입력 내용은 유지됩니다.",
    id: "Palet gagal dimuat. Input Anda tetap tersimpan.",
  }[language];
  const paletteTrigger = useRef<HTMLButtonElement | null>(null);
  const [paletteUndoValue, setPaletteUndoValue] = useState<string | null>(null);
  const paletteEmission = useRef<string | null>(null);
  useEffect(() => {
    if (value !== paletteEmission.current) setPaletteUndoValue(null);
  }, [value]);
  const changeFromPalette = (next: string) => {
    paletteEmission.current = next;
    setPaletteUndoValue(value);
    handlePaletteChange(next);
  };
  const catalog = useEmojiCatalog();
  const [PaletteView, setPaletteView] = useState<
    (typeof import("./emoji-input/EmojiPalette"))["default"] | null
  >(null);
  const [paletteError, setPaletteError] = useState(false);
  const [paletteAttempt, setPaletteAttempt] = useState(0);
  useEffect(() => {
    if (activeIndex === null || !catalog.ready || PaletteView) return;
    let alive = true;
    setPaletteError(false);
    void import("./emoji-input/EmojiPalette").then(
      (module) => {
        if (alive) setPaletteView(() => module.default);
      },
      () => {
        if (alive) setPaletteError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [activeIndex, catalog.ready, PaletteView, paletteAttempt]);
  return (
    <div
      className={`w-full ${showUtilities ? "space-y-6 sm:space-y-8" : ""} ${className}`}
    >
      {/* メイン入力エリア */}
      <div className="flex justify-center">
        <div
          className={
            fixedSize
              ? "w-full max-w-[48rem] mx-auto px-4"
              : "w-full max-w-[min(100%,48rem)] px-[clamp(0.75rem,4vw,2rem)]"
          }
        >
          <div
            className={
              fixedSize
                ? "grid grid-cols-5 gap-2 sm:gap-6 transition-all duration-300 ease-out"
                : "grid grid-cols-5 gap-[clamp(1.2rem,5vw,2.5rem)] transition-all duration-300 ease-out"
            }
          >
            {slots.map((_, index) => {
              const emoji = segments[index];
              const isActive = activeIndex === index;

              const isDragging = draggedIndex === index;
              const isDragTarget = dragOverIndex === index;

              const triggerButton = (
                <button
                  type="button"
                  disabled={disabled}
                  aria-haspopup="dialog"
                  aria-expanded={isActive}
                  onClick={(event) => {
                    paletteTrigger.current = event.currentTarget;
                    if (draggedIndex !== null) return;
                    void requireEmojiCatalog();
                    handleOpenChange(index, true);
                  }}
                  className={`flex aspect-square w-full ${fixedSize ? "min-w-0 sm:min-w-[4rem] max-w-[5rem] rounded-xl border-[1.5px] text-3xl" : "min-w-[2.8rem] max-w-[6rem] rounded-[clamp(1rem,4vw,1.7rem)] border-[clamp(1px,0.45vw,1.5px)] text-[clamp(1.8rem,6vw,3.2rem)]"} items-center justify-center transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${emoji ? "border-primary/60 bg-primary/5 shadow-md lg:shadow-lg" : "border-dashed border-primary/30 text-muted-foreground hover:border-primary/60 hover:text-primary"} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${isDragging ? "ring-2 ring-primary/50 scale-105 shadow-lg z-10 opacity-80" : ""} ${isDragTarget && !isDragging ? "border-primary/70 bg-primary/10 scale-105" : ""}`}
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
                  {emoji ? (
                    emoji
                  ) : (
                    <Plus
                      className={
                        fixedSize
                          ? "h-6 w-6"
                          : "h-[clamp(0.9rem,3.8vw,2rem)] w-[clamp(0.9rem,3.8vw,2rem)]"
                      }
                    />
                  )}
                </button>
              );

              return (
                <div
                  key={index}
                  className="group relative transition-all duration-200 ease-out"
                >
                  {triggerButton}

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

      {activeIndex === null && paletteUndoValue !== null && paletteUndoValue !== value && <div className="mt-2 flex justify-center"><Button data-palette-undo type="button" variant="ghost" size="sm" disabled={disabled || !catalog.ready} onClick={() => {paletteEmission.current = paletteUndoValue;handlePaletteChange(paletteUndoValue);setPaletteUndoValue(null);paletteTrigger.current?.focus();}}><Undo2 className="mr-1 h-3 w-3"/>{({ja:'元に戻す',en:'Undo',ko:'실행 취소',id:'Urungkan'})[language]}</Button></div>}
      <Dialog
        open={activeIndex !== null}
        onOpenChange={(open) => {
          if (!open && activeIndex !== null)
            handleOpenChange(activeIndex, false);
        }}
      >
        <DialogContent
          className="max-w-[min(42rem,calc(100vw-2rem))] rounded-2xl p-4 sm:p-6"
          onCloseAutoFocus={event => {event.preventDefault();if (paletteTrigger.current?.isConnected) paletteTrigger.current.focus();}}
          data-palette-dialog
          data-emoji-catalog-input
        >
          {catalog.ready && activeIndex !== null ? (
            PaletteView ? (
              <PaletteView
                key={activeIndex}
                value={value}
                onChange={changeFromPalette}
                onUndoUsed={() => setPaletteUndoValue(null)}
                initialIndex={activeIndex}
                onClose={() => handleOpenChange(activeIndex, false)}
                disabled={disabled}
                maxLength={maxLength}
              />
            ) : (
              <>
                <DialogTitle>
                  {t(paletteError ? "common.error" : "common.loading")}
                </DialogTitle>
                <DialogDescription role="status">
                  {paletteError ? paletteFailure : t("common.loading")}
                </DialogDescription>
                {paletteError && (
                  <Button onClick={() => setPaletteAttempt((v) => v + 1)}>
                    {t("common.tryAgain")}
                  </Button>
                )}
              </>
            )
          ) : (
            <>
              <DialogTitle>{t("common.searchEmojis")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("common.loading")}
              </DialogDescription>
              <EmojiCatalogInlineStatus />
            </>
          )}
        </DialogContent>
      </Dialog>

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
              aria-label={t("common.directInput")}
              className="h-[clamp(2.2rem,7vw,2.6rem)] sm:h-8 px-[clamp(0.5rem,2vw,0.8rem)] sm:px-3 rounded-full text-[clamp(0.65rem,2.3vw,0.8rem)] font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-[clamp(0.35rem,1.6vw,0.6rem)] sm:gap-1.5"
            >
              <Keyboard className="h-[clamp(0.85rem,3vw,1rem)] w-[clamp(0.85rem,3vw,1rem)] sm:h-3.5 sm:w-3.5" />
              <span className="text-[clamp(0.65rem,2.3vw,0.8rem)]">
                {t("common.directInput")}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handlePaste}
              aria-label={t("common.pasteFromClipboard")}
              className="h-[clamp(2.2rem,7vw,2.6rem)] sm:h-8 px-[clamp(0.5rem,2vw,0.8rem)] sm:px-3 rounded-full text-[clamp(0.65rem,2.3vw,0.8rem)] font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-[clamp(0.35rem,1.6vw,0.6rem)] sm:gap-1.5"
            >
              <Clipboard className="h-[clamp(0.85rem,3vw,1rem)] w-[clamp(0.85rem,3vw,1rem)] sm:h-3.5 sm:w-3.5" />
              <span className="text-[clamp(0.65rem,2.3vw,0.8rem)]">
                {t("common.paste")}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || !hasValue}
              onClick={handleClear}
              aria-label={t("common.clearAll")}
              className="h-[clamp(2.2rem,7vw,2.6rem)] sm:h-8 px-[clamp(0.5rem,2vw,0.8rem)] sm:px-3 rounded-full text-[clamp(0.65rem,2.3vw,0.8rem)] font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary flex items-center gap-[clamp(0.35rem,1.6vw,0.6rem)] sm:gap-1.5"
            >
              <Eraser className="h-[clamp(0.85rem,3vw,1rem)] w-[clamp(0.85rem,3vw,1rem)] sm:h-3.5 sm:w-3.5" />
              <span className="text-[clamp(0.65rem,2.3vw,0.8rem)]">
                {t("common.clear")}
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* 直接入力モーダル */}
      <Dialog open={showDirectInput} onOpenChange={setShowDirectInput}>
        <DialogContent data-emoji-catalog-input className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {t("common.directInput")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t("common.directInputDescription")}
              </p>
              <Input
                value={directInputText}
                onChange={(e) => setDirectInputText(e.target.value)}
                placeholder={t("common.directInputPlaceholder")}
                className="text-base"
                autoFocus
                {...directInputImeHandlers}
              />
            </div>
            <EmojiCatalogInlineStatus />
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDirectInput(false)}
                className="px-4"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleDirectInputConfirm}
                disabled={!directInputText.trim()}
                className="px-4"
              >
                {t("common.confirm")}
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
  const [confirming, setConfirming] = useState(false);
  const latestInput = useRef({ text: directInputText, open: showDirectInput, alive: true });
  latestInput.current = { ...latestInput.current, text: directInputText, open: showDirectInput };
  useEffect(() => {
    latestInput.current.alive = true;
    return () => { latestInput.current.alive = false; };
  }, []);

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

  const handleDirectInputConfirm = async () => {
    if (confirming) return;
    if (!directInputText.trim()) {
      setShowDirectInput(false);
      return;
    }

    setConfirming(true);
    try {
      if (!await requireEmojiCatalog()) return;
      if (!latestInput.current.alive || !latestInput.current.open || latestInput.current.text !== directInputText) return;
      onDirectInput?.(directInputText);
      setShowDirectInput(false);
      setDirectInputText('');
    } finally { setConfirming(false); }
  };

  const utilitiesImeHandlers = useImeAwareSubmit({
    onSubmit: () => handleDirectInputConfirm(),
    isDisabled: disabled || confirming,
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
        <DialogContent data-emoji-catalog-input className="max-w-md">
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
            <EmojiCatalogInlineStatus />
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
                disabled={!directInputText.trim() || confirming}
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
