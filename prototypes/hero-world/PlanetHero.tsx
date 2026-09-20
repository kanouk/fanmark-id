import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw, Plus, Minus } from 'lucide-react';
import { useTranslation } from '../../src/hooks/useTranslation';
import type { HomeHeroProps } from '../../src/pages/Index';
import { toast } from '../../src/hooks/use-toast';
import type { WorldController } from './world';
import { fallbackFanmarks, people } from './places';

export function PlanetHero({ onExplore, recentFanmarks }: HomeHeroProps) {
  const { language, t, tWithBreaks } = useTranslation();
  const ja = language === 'ja';
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<WorldController>();
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [identities, setIdentities] = useState<string[] | null>(null);
  useEffect(() => {
    if (recentFanmarks) setIdentities(previous => previous ?? [...new Set([...recentFanmarks.map(f => f.emoji), ...fallbackFanmarks])].slice(0, people.length + 8));
  }, [recentFanmarks]);
  const choose = useCallback(async (emoji: string) => {
    try {
      await navigator.clipboard.writeText(emoji);
      toast({ title: t('dashboard.emojiCopiedTitle'), description: emoji });
    } catch {
      toast({ title: ja ? 'コピーできませんでした' : 'Could not copy', description: emoji, variant: 'destructive' });
    }
  }, [t, ja]);
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    let cancelled = false;
    setReady(false); setFailed(false);
    import('./world').then(({ createWorld }) => {
      if (cancelled || !host.current) return;
      world.current = createWorld(host.current, emoji => { void chooseRef.current(emoji); }, () => { setFailed(true); setReady(false); });
      setReady(true);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; world.current?.dispose(); world.current = undefined; };
  }, [attempt]);
  useEffect(() => { world.current?.setPaused(paused); }, [paused, ready]);
  useEffect(() => { if (identities) world.current?.setFanmarks(identities); }, [identities, ready]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setPaused(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return <div className="planet-hero">
    <div className="planet-layout">
      <div className="planet-copy">
        <h1>{tWithBreaks('hero.subtitle')}</h1>
        <p className="planet-description">{t('hero.description')}</p>
        <p className="planet-story">{ja ? <>ひとりひとりの「好き」が、目印になる。</> : <>Little passions. Unique personalities.</>}</p>
        <button className="planet-cta" onClick={onExplore}>{t('hero.tryButton')}<ArrowRight size={18}/></button>

      </div>
      <div className={`planet-stage ${ready && !failed ? 'is-ready' : ''}`}>
        <div ref={host} className="planet-canvas" tabIndex={ready ? 0 : -1} role="group" aria-label={ja ? 'ドラッグで惑星を回す。矢印キーでも回転できます。ファンマを押すとコピーできます。' : 'Drag or use arrow keys to turn the planet. Tap a fanmark to copy.'}/>
        {!ready && <div className="planet-loading" role="status">{failed ? <><p>{ja ? '3Dを表示できませんでした。検索はそのまま使えます。' : 'The planet could not load. You can still search below.'}</p><button onClick={() => setAttempt(v => v + 1)}>{ja ? 'もう一度表示する' : 'Try again'}</button></> : <><span className="planet-loader"/>{ja ? '小さな世界を準備中…' : 'Making a little world…'}</>}</div>}
        <div className="planet-controls" role="group" aria-label={ja ? '惑星の操作' : 'Planet controls'}>
          <button disabled={!ready} onClick={() => world.current?.rotate(-.32,0)} aria-label={ja ? '惑星を左へ回す' : 'Turn left'}><ArrowLeft size={17}/></button>
          <button disabled={!ready} onClick={() => world.current?.rotate(.32,0)} aria-label={ja ? '惑星を右へ回す' : 'Turn right'}><ArrowRight size={17}/></button>
          <button disabled={!ready} onClick={() => world.current?.zoom(.15)} aria-label={ja ? '惑星を拡大' : 'Zoom in'}><Plus size={17}/></button>
          <button disabled={!ready} onClick={() => world.current?.zoom(-.15)} aria-label={ja ? '惑星を縮小' : 'Zoom out'}><Minus size={17}/></button>
          <button disabled={!ready} onClick={() => setPaused(v => !v)} aria-label={paused ? (ja ? '歩く動きを再生' : 'Play animation') : (ja ? '歩く動きを止める' : 'Pause animation')}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
          <button disabled={!ready} onClick={() => world.current?.reset()} aria-label={ja ? '最初の向きに戻す' : 'Reset view'}><RotateCcw size={15}/></button>
        </div>
      </div>
    </div>
    <div className="sr-only" role="group" aria-label={ja ? 'ファンマをコピー' : 'Copy a fanmark'}>
      {(identities ?? []).map(emoji => <button key={emoji} onClick={() => void choose(emoji)}>{emoji}</button>)}
    </div>
  </div>;
}
