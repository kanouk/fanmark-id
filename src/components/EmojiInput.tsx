import React, { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CustomEmojiPicker } from '@/components/ui/emoji-picker';
import { Smile, Sparkles } from 'lucide-react';

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
  maxLength = 10,
  className = '',
  onSearchPerformed
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
            aria-label={disabled ? '絵文字ピッカー（無効）' : '絵文字ピッカーを開く'}
            title={disabled ? '絵文字ピッカー（無効）' : '絵文字ピッカーを開く'}
            disabled={disabled}
          >
            <Smile className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 border-base-300 bg-base-100 w-auto"
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={16}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <CustomEmojiPicker onEmojiSelect={handleEmojiSelect} disabled={disabled} />
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="AIでおすすめ（近日対応）"
        title="近日対応予定: AIが自然文や画像からファンマを提案します"
        disabled
      >
        <Sparkles className="h-4 w-4" />
      </Button>
    </div>
  );
};
