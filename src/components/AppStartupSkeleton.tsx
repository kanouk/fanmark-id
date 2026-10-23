import { BrandIcon } from '@/components/BrandIcon';

/** Public chrome only: shares the pre-JS shell; readiness still gates every route. */
export function AppStartupSkeleton() {
  const language = typeof document === 'undefined' ? 'ja' : document.documentElement.lang;
  const layout = typeof window !== 'undefined' && window.location.pathname === '/auth' ? 'auth' : 'app';
  return <main data-app-startup data-startup-layout={layout} aria-busy="true" className="app-startup">
    <header><div className="app-startup-bar"><span className="app-startup-icon"><BrandIcon size="sm" /></span><span className="app-startup-name">{language === 'ja' ? 'ファンマID' : 'Fanmark'}</span></div></header>
    <div aria-hidden="true" className="app-startup-body">
      <div className="app-startup-line" /><div className="app-startup-line app-startup-line-short" />
      <div className="app-startup-slots">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>
    </div>
  </main>;
}
