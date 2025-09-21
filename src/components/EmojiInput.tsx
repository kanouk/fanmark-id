import React, { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CustomEmojiPicker } from '@/components/ui/emoji-picker';

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
  const [isFocused, setIsFocused] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
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

  const handleInputFocus = () => {
    setIsFocused(true);
    setIsPickerOpen(true);
  };

  const handleInputBlur = () => {
    setIsFocused(false);
    setTimeout(() => {
      if (!isInteracting) {
        setIsPickerOpen(false);
      }
    }, 150);
  };

  const handlePickerOpenChange = (open: boolean) => {
    setIsPickerOpen(open);
    if (!open) {
      setIsFocused(false);
    }
  };

  return (
    <div className="relative w-full">
      <Popover open={isPickerOpen} onOpenChange={handlePickerOpenChange}>
        <PopoverTrigger asChild>
          <Input
            ref={inputRef}
            value={value}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            className={className}
          />
        </PopoverTrigger>
        <PopoverContent 
          className="p-0 border-base-300 bg-base-100" 
          align="start" 
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseDown={() => setIsInteracting(true)}
          onMouseUp={() => setTimeout(() => setIsInteracting(false), 0)}
          onPointerLeave={() => setIsInteracting(false)}
        >
          <CustomEmojiPicker
            onEmojiSelect={handleEmojiSelect}
            disabled={disabled}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};
