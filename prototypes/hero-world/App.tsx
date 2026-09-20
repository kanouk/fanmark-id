import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Check, Copy, Globe2, Pause, Play, RotateCcw, Sparkles } from 'lucide-react';
import brand from '../../src/assets/sparkles.png';
import { places, type PlaceId } from './places';
import type { WorldController } from './world';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<WorldController>();
  const [language, setLanguage] = useState<'ja' | 'en'>('ja');
  const [selected, setSelected] = useState<PlaceId>('garden');
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [quality, setQuality] = useState<'3d' | 'still'>('3d');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [explore, setExplore] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const isJa = language === 'ja';
  const place = places.find(p => p.id === selected)!;
  const choose = useCallback((id: PlaceId) => { setSelected(id); setCopied(false); setCopyFailed(false); }, []);

  useEffect(() => {
    let cancelled = false;
    if (quality === 'still') { setReady(false); return; }
    setReady(false); setFailed(false);
    import('./world').then(({ createWorld }) => {
      if (cancelled || !host.current) return;
      controller.current = createWorld(host.current, choose, () => { setFailed(true); setReady(false); });
      setReady(true);
    }).catch(() => { if (!cancelled) { setFailed(true); setReady(false); } });
    return () => { cancelled = true; controller.current?.dispose(); controller.current = undefined; };
  }, [choose, quality]);
  useEffect(() => { controller.current?.select(selected); }, [selected, ready]);
  useEffect(() => { controller.current?.setPaused(paused); }, [paused, ready]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setPaused(media.matches);
    media.addEventListener('change', change);
    return () => { media.removeEventListener('change', change); clearTimeout(copyTimer.current); };
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(place.emoji);
      setCopied(true); setCopyFailed(false);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch { setCopyFailed(true); }
  };
  const start = () => { setExplore(true); document.getElementById('your-mark')?.scrollIntoView({ behavior: paused ? 'instant' : 'smooth', block: 'center' }); };

  return <div className="world-page">
    <header className="site-header">
      <a href="#" className="brand" aria-label="fanmark.id home"><img src={brand} alt=""/><span>fanmark<span className="brand-dot">.</span>id</span></a>
      <nav aria-label={isJa ? 'メインナビゲーション' : 'Main navigation'}>
        <a className="about-link" href="#about">{isJa ? 'ファンマって？' : 'What is a fanmark?'}</a>
        <button className="language" onClick={() => setLanguage(isJa ? 'en' : 'ja')} aria-label={isJa ? 'Switch to English' : '日本語に切り替える'}><Globe2 size={16}/>{isJa ? 'EN' : 'JA'}</button>
        <button className="nav-start" onClick={start}>{isJa ? 'ファンマを見つける' : 'Find your mark'}<ArrowRight size={15}/></button>
      </nav>
    </header>
    <main>
      <section className="world-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="eyebrow"><span className="tiny-flower">✳</span> A LITTLE WORLD OF YOU</div>
          <h1 id="hero-title">{isJa ? <>「好き」がつながる、<br/><span>あなたの目印。</span></> : <>A little mark.<br/><span>A world of you.</span></>}</h1>
          <p>{isJa ? <>花も、音楽も、コーヒーも。<br className="mobile-break"/> あなたらしさを、絵文字のアドレスに。</> : <>Your flowers, your music, your coffee.<br className="mobile-break"/> Your very own emoji address.</>}</p>
          <button className="primary-cta" onClick={start}>{isJa ? 'わたしのファンマを見つける' : 'Find my fanmark'}<ArrowRight size={18}/></button>
          <span className="hero-footnote">{isJa ? '小さな絵文字から、つながりがはじまる。' : 'Little emojis. Lovely connections.'}</span>
        </div>
        <div className={`world-stage ${ready && !failed ? 'is-ready' : ''}`}>
          <div className="scene-caption"><span className="live-dot"/> FANMARK GARDEN <span className="caption-number">01 — 04</span></div>
          <div className="world-fallback" aria-hidden="true"><img src="/world-poster.svg" alt=""/></div>
          <div ref={host} className="world-canvas" aria-hidden="true"/>
          <div className="world-note note-left"><span>☁</span> {isJa ? 'みんなの「好き」が暮らす街' : 'Where little passions live'}</div>
          <div className="world-note note-right">{quality === 'still' || failed ? (isJa ? '下から「好き」を選んでみて' : 'Pick a favorite below') : (isJa ? '看板をタップしてみて' : 'Tap a little sign')} <span>↙</span></div>
          <div className="world-controls">
            <button onClick={() => setPaused(!paused)} aria-label={paused ? (isJa ? '動きを再生' : 'Play animation') : (isJa ? '動きを止める' : 'Pause animation')} disabled={!ready || failed || quality === 'still'}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
            <button onClick={() => controller.current?.reset()} aria-label={isJa ? '視点を戻す' : 'Reset view'} disabled={!ready || failed}><RotateCcw size={15}/></button>
            <button className="quality-switch" aria-pressed={quality === 'still'} onClick={() => setQuality(quality === '3d' ? 'still' : '3d')}>{quality === '3d' ? (isJa ? '静止画' : 'Still') : '3D'}</button>
          </div>
          <div className="scene-status" role="status">{failed ? (isJa ? '静止画で表示しています' : 'Showing the still garden') : ''}</div>
        </div>
        <div className="discovery" id="your-mark">
          <div className="discovery-intro"><span className="discovery-label">PICK A LITTLE PERSONALITY</span><p>{isJa ? 'どの「好き」に、会いにいく？' : 'Which little world feels like you?'}</p></div>
          <div className="place-options" role="group" aria-label={isJa ? '街のファンマークを選ぶ' : 'Pick a fanmark in the garden'}>{places.map(p => <button key={p.id} aria-pressed={selected === p.id} onClick={() => choose(p.id)} className={selected === p.id ? 'selected' : ''}><span className="option-emoji">{p.emoji}</span><span>{isJa ? p.label : p.labelEn}</span>{selected === p.id && <span className="selected-dot"/>}</button>)}</div>
        </div>
      </section>
      <section className={`address-section ${explore ? 'is-exploring' : ''}`} aria-labelledby="address-title">
        <div className="address-copy"><span className="section-kicker">YOUR EMOJI, YOUR ADDRESS</span><h2 id="address-title" aria-live="polite">{isJa ? place.name : place.en}</h2><p>{isJa ? '好きな絵文字を組み合わせると、あなたらしい入口に。' : 'Put your favorite emojis together. Make an entrance that’s you.'}</p></div>
        <div className="address-card"><span className="address-label">{isJa ? 'こんなアドレス、どう？' : 'How about this address?'}</span><div className="address-line"><span>fanmark.id/</span><strong>{place.emoji}</strong><button onClick={copy} aria-label={isJa ? '絵文字をコピー' : 'Copy emojis'}>{copied ? <Check size={19}/> : <Copy size={19}/>}</button></div><div className="address-bottom"><span role="status">{copyFailed ? (isJa ? '上の絵文字を選択してコピーしてください' : 'Select the emojis above to copy') : copied ? (isJa ? 'コピーしました' : 'Copied!') : (isJa ? 'サンプルのアドレスです' : 'An example address')}</span><a href="http://127.0.0.1:4178/">{isJa ? 'パレットで自由につくる' : 'Open the emoji palette'}<ArrowRight size={13}/></a></div></div>
      </section>
      <section className="about-section" id="about"><div className="about-symbol"><Sparkles size={22}/></div><div><h2>{isJa ? '言葉よりも、あなたらしく。' : 'A little more you. A little less ordinary.'}</h2><p>{isJa ? 'ファンマークは、人やお店、好きな場所につながる絵文字のアドレス。あなたの「好き」を並べて、世界にひとつの入口をつくろう。' : 'A fanmark is an emoji address for people, shops, and places you love. Bring your favorites together and make a little doorway of your own.'}</p></div><ArrowDown size={22}/></section>
    </main>
    <footer><span>© fanmark.id</span><span>{isJa ? '箱庭ヒーローのデザインプレビュー' : 'A preview of the fanmark garden'}</span><span>Made of little things. ✳</span></footer>
  </div>;
}
