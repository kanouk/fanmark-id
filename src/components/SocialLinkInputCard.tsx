import type React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AtSign, Link2 } from 'lucide-react';
import type { SocialPlatform } from '@/lib/social-platforms';

export type SocialLinkInputMode = 'handle' | 'url';

interface SocialLinkInputCardProps {
  platform: SocialPlatform;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  mode: SocialLinkInputMode;
  onModeChange: (mode: SocialLinkInputMode) => void;
  errorMessage?: string;
  inputId: string;
  inputRef?: React.Ref<HTMLInputElement>;
  showTitle?: boolean;
  titleOverride?: string;
}

export const SocialLinkInputCard = ({
  platform,
  value,
  onChange,
  onBlur,
  mode,
  onModeChange,
  errorMessage,
  inputId,
  inputRef,
  showTitle = true,
  titleOverride,
}: SocialLinkInputCardProps) => {
  const isHandleMode = mode === 'handle' && !!platform.baseUrl;
  const baseUrl = platform.baseUrl || '';
  const handleValue = isHandleMode && value.startsWith(baseUrl)
    ? value.slice(baseUrl.length)
    : isHandleMode
      ? ''
      : undefined;

  const toggleMode = () => {
    if (!platform.baseUrl) return;
    const nextMode: SocialLinkInputMode = isHandleMode ? 'url' : 'handle';
    onModeChange(nextMode);
    const currentValue = value || '';

    if (nextMode === 'url') {
      const withoutBase = currentValue.startsWith(baseUrl) ? currentValue.slice(baseUrl.length) : '';
      const nextUrl = withoutBase ? `${baseUrl}${withoutBase}` : `${baseUrl}`;
      onChange(nextUrl);
    } else if (!currentValue || currentValue === baseUrl) {
      onChange(baseUrl);
    }
  };

  const Icon = platform.icon;

  return (
    <div className="rounded-2xl border border-border/60 bg-background/70 p-4 shadow-sm transition hover:border-primary/30 hover:shadow-lg">
      {(showTitle || platform.baseUrl) && (
        <div className={`flex flex-wrap items-center gap-3 ${showTitle ? 'justify-between' : 'justify-end'}`}>
          {showTitle && (
            <Label htmlFor={inputId} className="text-sm font-medium flex items-center gap-1.5 text-foreground/90">
              <span className="p-1.5 rounded-lg bg-primary/5">
                <Icon className="h-4 w-4 text-primary" />
              </span>
              {titleOverride ?? platform.label}
            </Label>
          )}
          {platform.baseUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`${platform.label}の入力モード切り替え`}
              aria-pressed={isHandleMode}
              className="flex h-9 items-center rounded-full border-border/70 bg-background/80 px-1 text-muted-foreground transition-colors"
              onClick={toggleMode}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/70 transition-colors ${isHandleMode ? 'bg-primary text-primary-foreground shadow-sm' : ''}`}
              >
                <AtSign className="h-3.5 w-3.5" />
              </span>
              <span
                className={`ml-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/70 transition-colors ${!isHandleMode ? 'bg-primary text-primary-foreground shadow-sm' : ''}`}
              >
                <Link2 className="h-3.5 w-3.5" />
              </span>
            </Button>
          )}
        </div>
      )}

      <div className="mt-3">
        {isHandleMode ? (
          <div className={`flex h-12 items-center overflow-hidden rounded-xl border ${errorMessage ? 'border-destructive/60 ring-2 ring-destructive/20' : 'border-border/80'} bg-background/90 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all`}>
            <span className="hidden sm:flex h-full items-center bg-muted/30 px-3 text-sm font-medium text-muted-foreground/80">
              {baseUrl}
            </span>
            <span className="sm:hidden flex h-full items-center bg-muted/30 px-3 text-xs font-medium text-muted-foreground/80">
              @{platform.label}
            </span>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={handleValue ?? ''}
              onChange={(event) => {
                const rawHandle = event.target.value.trim();
                const cleanedHandle = (() => {
                  const withoutProtocol = rawHandle.replace(/^https?:\/\//i, '');
                  const normalizedBase = baseUrl.replace(/^https?:\/\//i, '');
                  let next = withoutProtocol;
                  if (normalizedBase && next.startsWith(normalizedBase)) {
                    next = next.slice(normalizedBase.length);
                  }
                  return next.replace(/^\/+/, '');
                })();
                onChange(cleanedHandle ? `${baseUrl}${cleanedHandle}` : '');
              }}
              onBlur={onBlur}
              placeholder={platform.handlePlaceholder || 'username'}
              className="flex-1 h-full bg-transparent px-3 text-sm sm:text-base outline-none placeholder:text-muted-foreground/40"
              autoComplete="off"
            />
          </div>
        ) : (
          <Input
            id={inputId}
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            placeholder={platform.placeholder}
            className={`h-12 rounded-xl border-2 px-4 text-sm sm:text-base placeholder:text-muted-foreground/40 transition-colors ${errorMessage ? 'border-destructive/60 focus-visible:ring-destructive/30' : 'border-border hover:border-primary/30 focus:border-primary'}`}
          />
        )}
      </div>

      {errorMessage && (
        <p className="mt-2 text-xs font-medium text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
};
