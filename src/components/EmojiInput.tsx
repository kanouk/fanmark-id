import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CustomEmojiPicker } from '@/components/ui/emoji-picker';
import { Smile } from 'lucide-react';

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

  const handleEmojiSelect = (emoji: string) => {
    const newValue = value + emoji;
    if (newValue.length <= maxLength) {
      onChange(newValue);
      if (onSearchPerformed) {
        onSearchPerformed(newValue);
      }
    }
    setIsPickerOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    if (onSearchPerformed && newValue.trim()) {
      onSearchPerformed(newValue);
    }
  };

  return (
    <div className="relative flex w-full">
      <Input
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        className={`pr-12 ${className}`}
      />
      <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 hover:bg-base-200"
            aria-label="Open emoji picker"
          >
            <Smile className="h-4 w-4 text-base-content/70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="p-0 border-base-300 bg-base-100" 
          align="end" 
          sideOffset={4}
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