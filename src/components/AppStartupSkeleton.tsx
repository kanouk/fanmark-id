import { BrandIcon } from '@/components/BrandIcon';

/** Public chrome only: never show account data before the readiness gates pass. */
export function AppStartupSkeleton() {
  return <main data-app-startup aria-busy="true" className="min-h-screen bg-background text-foreground">
    <header className="flex h-20 items-center gap-3 border-b px-6"><BrandIcon size="sm" /><span className="text-xl font-semibold">ファンマID</span></header>
    <div aria-hidden="true" className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 py-24 motion-safe:animate-pulse">
      <div className="h-10 w-3/4 rounded-xl bg-muted" /><div className="h-5 w-1/2 rounded bg-muted" />
      <div className="mt-12 grid w-full max-w-lg grid-cols-5 gap-4">{Array.from({ length: 5 }, (_, index) => <div key={index} className="aspect-square rounded-2xl border border-primary/20 bg-muted/40" />)}</div>
    </div>
  </main>;
}
