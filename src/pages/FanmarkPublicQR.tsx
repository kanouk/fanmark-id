import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useFanmarkByShortId } from '@/hooks/useFanmarkByShortId';
import { getFanmarkShortUrl } from '@/utils/emojiUrl';
import FanmarkQRCodeCard from '@/components/FanmarkQRCodeCard';
import { Loader2, AlertTriangle } from 'lucide-react';

const FanmarkPublicQR = () => {
  const { shortId } = useParams<{ shortId: string }>();
  const { t } = useTranslation();
  const { data, loading, error } = useFanmarkByShortId(shortId);

  const shareUrl = useMemo(() => getFanmarkShortUrl(shortId || ''), [shortId]);

  const showContent = !loading && !error && data && !!shortId;

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-10">
        <div className="flex flex-1 flex-col items-center justify-center gap-10 py-12 text-center">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-primary/70">{t('qr.title')}</p>
            {showContent ? (
              <h1 className="text-3xl font-semibold text-foreground md:text-4xl">
                {t('qr.subtitle')}
              </h1>
            ) : (
              <h1 className="text-3xl font-semibold text-foreground md:text-4xl">
                {t('qr.titleFallback')}
              </h1>
            )}
            <p className="mx-auto max-w-xl text-sm text-muted-foreground md:text-base">
              {t('qr.description')}
            </p>
          </div>

          {loading && (
            <div className="flex items-center gap-3 rounded-full border border-primary/20 bg-background/90 px-5 py-3 shadow-lg">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm font-medium text-muted-foreground">{t('common.loading')}</span>
            </div>
          )}

          {!loading && error && (
            <div className="max-w-md rounded-3xl border border-destructive/20 bg-background/90 px-6 py-8 text-center shadow-[0_25px_60px_rgba(244,63,94,0.18)]">
              <div className="flex justify-center">
                <AlertTriangle className="h-10 w-10 text-destructive" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-foreground">{t('qr.loadErrorTitle')}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t('qr.loadErrorDescription')}</p>
            </div>
          )}

          {showContent && data && (
            <FanmarkQRCodeCard emoji={data.fanmark} url={shareUrl} shortId={shortId || ''} />
          )}
        </div>
      </div>
    </div>
  );
};

export default FanmarkPublicQR;
