import { useTranslation } from '@/hooks/useTranslation';

export function PageLoadError() {
  const { language } = useTranslation();
  const copy = {
    ja: ['画面を読み込めませんでした', '通信状態を確認して、もう一度お試しください。', '再読み込み'],
    en: ['This page could not be loaded', 'Check your connection and try again.', 'Reload'],
    ko: ['화면을 불러오지 못했습니다', '네트워크 연결을 확인하고 다시 시도해 주세요.', '새로고침'],
    id: ['Halaman gagal dimuat', 'Periksa koneksi Anda dan coba lagi.', 'Muat ulang'],
  }[language] ?? ['This page could not be loaded', 'Check your connection and try again.', 'Reload'];
  return <main role="alert" className="grid min-h-[70vh] place-items-center px-6 text-center"><div className="space-y-4">
    <h1 className="text-xl font-semibold">{copy[0]}</h1><p className="text-muted-foreground">{copy[1]}</p>
    <button type="button" className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={() => window.location.reload()}>{copy[2]}</button>
  </div></main>;
}

