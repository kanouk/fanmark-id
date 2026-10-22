import { useEffect, type ReactNode } from 'react';
import { useEmojiCatalog } from '@/hooks/useEmojiCatalog';
import { useTranslation } from '@/hooks/useTranslation';
import { emojiCatalog } from '@/lib/emoji-catalog-state';

const messages = {
  ja: { loading: '絵文字を準備しています…', error: '絵文字を読み込めませんでした。入力内容はそのままです。', retry: 'もう一度試す' },
  en: { loading: 'Getting emoji ready…', error: 'Emoji could not be loaded. Your input is kept.', retry: 'Try again' },
  ko: { loading: '이모지를 준비하고 있습니다…', error: '이모지를 불러오지 못했습니다. 입력 내용은 유지됩니다.', retry: '다시 시도' },
  id: { loading: 'Menyiapkan emoji…', error: 'Emoji gagal dimuat. Input Anda tetap tersimpan.', retry: 'Coba lagi' },
};

function CatalogMessage() {
  const { phase } = useEmojiCatalog();
  const { language } = useTranslation();
  const copy = messages[language] ?? messages.ja;
  return <div role={phase === 'error' ? 'alert' : 'status'} className="flex flex-wrap items-center justify-center gap-3 text-sm">
    {phase !== 'error' && <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-primary/25 border-t-primary motion-safe:animate-spin" />}
    <span>{phase === 'error' ? copy.error : copy.loading}</span>
    {phase === 'error' && <button type="button" className="rounded-md bg-primary px-3 py-2 text-primary-foreground" onClick={() => { void emojiCatalog.load(); }}>{copy.retry}</button>}
  </div>;
}

/** Only appears after an operation needs the catalog; the rest of the page stays usable. */
export function EmojiCatalogNotice() {
  const { ready, demanded } = useEmojiCatalog();
  if (ready || !demanded) return null;
  return <aside data-emoji-catalog-notice className="fixed inset-x-4 bottom-4 z-[100] mx-auto w-fit max-w-[calc(100%-2rem)] rounded-2xl border bg-background px-5 py-4 shadow-lg [body:has([data-emoji-catalog-input])_&]:hidden"><CatalogMessage /></aside>;
}

export function EmojiCatalogInlineStatus() {
  const { ready, demanded } = useEmojiCatalog();
  return !ready && demanded ? <CatalogMessage /> : null;
}

export function EmojiCatalogGate({ children }: { children: ReactNode }) {
  const { ready } = useEmojiCatalog();
  useEffect(() => { void emojiCatalog.load(); }, []);
  return ready ? children : <div className="grid min-h-[50vh] place-items-center px-6"><CatalogMessage /></div>;
}
