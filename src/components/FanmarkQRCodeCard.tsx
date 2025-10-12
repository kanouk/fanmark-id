import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import { segmentEmojiSequence } from '@/lib/emojiConversion';

interface FanmarkQRCodeCardProps {
  emoji: string;
  url: string;
  shortId: string;
  className?: string;
}

const getEmojiLayoutClasses = (count: number) => {
  if (count <= 1) {
    return {
      wrapper: 'px-4',
      gap: 'gap-0',
      text: 'text-[3rem]',
    };
  }

  if (count === 2) {
    return {
      wrapper: 'px-5',
      gap: 'gap-2',
      text: 'text-[2.75rem]',
    };
  }

  if (count === 3) {
    return {
      wrapper: 'px-6',
      gap: 'gap-2',
      text: 'text-[2.5rem]',
    };
  }

  if (count === 4) {
    return {
      wrapper: 'px-6',
      gap: 'gap-1.5',
      text: 'text-[2.25rem]',
    };
  }

  return {
    wrapper: 'px-6',
    gap: 'gap-1',
    text: 'text-[2rem]',
  };
};

export const FanmarkQRCodeCard = ({ emoji, url, shortId, className }: FanmarkQRCodeCardProps) => {
  const emojiSegments = segmentEmojiSequence(emoji ?? '').slice(0, 5);
  const displaySegments = emojiSegments.length > 0 ? emojiSegments : ['✨'];
  const layout = getEmojiLayoutClasses(displaySegments.length);

  return (
    <div
      className={cn(
        'relative flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-primary/20 bg-background/90 p-8 text-center shadow-[0_30px_80px_rgba(101,195,200,0.22)] backdrop-blur',
        className,
      )}
    >
      <div className={cn('flex min-h-[5rem] min-w-[5rem] items-center justify-center rounded-full bg-primary/15 drop-shadow-sm', layout.wrapper)}>
        <div className={cn('flex flex-nowrap items-center justify-center', layout.gap)}>
          {displaySegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className={cn('select-none leading-none', layout.text)}>
              {segment}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-inner shadow-primary/10">
        <QRCodeSVG value={url} size={232} includeMargin fgColor="#111827" bgColor="#ffffff" />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-primary/80">fanmark id</p>
        <p className="font-mono text-sm text-muted-foreground">{shortId}</p>
      </div>
    </div>
  );
};

export default FanmarkQRCodeCard;
