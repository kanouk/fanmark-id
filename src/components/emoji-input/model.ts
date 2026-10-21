export interface EmojiInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  onSearchPerformed?: (query: string) => void;
  showUtilities?: boolean;
  fixedSize?: boolean; // モバイル固定サイズモード
}

export const DEFAULT_MAX_LENGTH = 5;

