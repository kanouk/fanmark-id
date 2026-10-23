import { BrandIcon } from '@/components/BrandIcon';
import { useEffect, useState } from 'react';

const slowMessages: Record<string, string> = {
  ja: 'サービスの状態を確認しています。通信に時間がかかっています。',
  en: 'Checking service status. The connection is taking longer than usual.',
  ko: '서비스 상태를 확인하고 있습니다. 연결에 시간이 걸리고 있습니다.',
  id: 'Memeriksa status layanan. Koneksi membutuhkan waktu lebih lama dari biasanya.',
};

/** Public chrome only: shares the pre-JS shell; readiness still gates every route. */
export function AppStartupSkeleton() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 5_000);
    return () => clearTimeout(timer);
  }, []);
  const language = typeof document === 'undefined' ? 'ja' : document.documentElement.lang;
  const layout = typeof window !== 'undefined' && window.location.pathname === '/auth' ? 'auth' : 'app';
  return <main data-app-startup data-startup-layout={layout} aria-busy="true" className="app-startup">
    <header><div className="app-startup-bar"><span className="app-startup-icon"><BrandIcon size="sm" /></span><span className="app-startup-name">{language === 'ja' ? 'ファンマID' : 'Fanmark'}</span></div></header>
    <div aria-hidden="true" className="app-startup-body">
      <div className="app-startup-line" /><div className="app-startup-line app-startup-line-short" />
      <div className="app-startup-slots">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>
    </div>
    <p role="status" className="app-startup-status">{slow ? (slowMessages[language] ?? slowMessages.en) : ''}</p>
  </main>;
}
