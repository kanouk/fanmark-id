import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Globe2, History, Plus, Search, Sparkles, Loader2, Undo2, X } from 'lucide-react';
import { byId, catalog, categories, findEmoji, recommended, searchEmoji, type EmojiEntry, type Language } from './search';
import brand from '../../src/assets/sparkles.png';
import { useJevSearch } from './useJevSearch';

const HISTORY_KEY = 'fanmark.palette-prototype.history.v1';
const initialSelection = ['🌸', '🌿'].map(emoji => findEmoji(emoji)!.id);
const loadHistory = (): string[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(stored) ? [...new Set(stored.filter((id): id is string => typeof id === 'string' && byId.has(id)))].slice(0, 24) : [];
  } catch { return []; }
};
type Mode = 'insert' | 'replace';
type Snapshot = { selected: string[]; cursor: number; mode: Mode };

export function App() {
  const [language, setLanguage] = useState<Language>('ja');
  const [selected, setSelected] = useState(initialSelection);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(2);
  const [mode, setMode] = useState<Mode>('insert');
  const [query, setQuery] = useState('');
  const [jevEnabled, setJevEnabled] = useState(true);
  const [isComposing, setIsComposing] = useState(false);
  const [category, setCategory] = useState('');
  const [browse, setBrowse] = useState(false);
  const [variants, setVariants] = useState(false);
  const [limit, setLimit] = useState(64);
  const [history, setHistory] = useState(loadHistory);
  const [undo, setUndo] = useState<Snapshot | null>(null);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [historySaved, setHistorySaved] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  const t = (ja: string, en: string) => language === 'ja' ? ja : en;
  const label = (entry: EmojiEntry) => language === 'ja' ? entry.ja : entry.name;
  const sequence = selected.map(id => byId.get(id)!.emoji).join('');
  const full = selected.length === 5 && mode === 'insert';
  const dictionaryResults = useMemo(() => searchEmoji(query, category, variants), [query, category, variants]);
  const jev = useJevSearch(query, category, variants, jevEnabled && open, isComposing);
  const results = useMemo(() => [...new Map([
    ...jev.ids.map(id => byId.get(id)!), ...dictionaryResults,
  ].map(entry => [entry.id, entry])).values()], [jev.ids, dictionaryResults]);
  const jevIds = new Set(jev.ids);
  const searching = Boolean(query.trim() || browse || category);
  const shown = searching ? results.slice(0, limit) : recommended;
  const examples = language === 'ja' ? ['美容室', 'カフェ', '控えめに応援', '宇宙'] : ['hair salon', 'coffee', 'support', 'space'];

  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { setLimit(64); }, [query, category, variants]);
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); setHistorySaved(true); }
    catch { setHistorySaved(false); }
  }, [history]);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timeout);
  }, [copied]);

  function launch(index: number, nextMode: Mode, keyword?: string) {
    lastTrigger.current = document.activeElement as HTMLElement;
    setMode(nextMode);
    setCursor(Math.min(index, selected.length));
    if (keyword !== undefined) { setQuery(keyword); setCategory(''); setBrowse(false); }
    setOpen(true);
  }
  function remember() { setUndo({ selected: [...selected], cursor, mode }); setCopied(false); }
  function choose(entry: EmojiEntry) {
    if (full) return;
    remember();
    const next = [...selected];
    if (mode === 'replace') {
      next[cursor] = entry.id;
      setOpen(false);
    } else {
      next.splice(cursor, 0, entry.id);
      setCursor(cursor + 1);
    }
    setSelected(next);
    setHistory(previous => [entry.id, ...previous.filter(id => id !== entry.id)].slice(0, 24));
    setNotice(t(`${label(entry)}を${mode === 'replace' ? '置き換え' : '追加し'}ました`, `${label(entry)} ${mode === 'replace' ? 'replaced' : 'added'}`));
  }
  function remove(index: number) {
    remember();
    const next = selected.filter((_, position) => position !== index);
    setSelected(next);
    if (mode === 'replace' && cursor === index) {
      setMode('insert'); setCursor(Math.min(index, next.length));
    } else setCursor(Math.min(cursor - (index < cursor ? 1 : 0), next.length));
    setNotice(t('絵文字を削除しました', 'Emoji removed'));
  }
  function clearSelection() {
    if (!selected.length) return;
    remember();
    setSelected([]); setCursor(0); setMode('insert');
    setNotice(t('入力中の絵文字をすべてクリアしました', 'All selected emojis cleared'));
  }
  function move(index: number, delta: number) {
    if (index + delta < 0 || index + delta >= selected.length) return;
    remember();
    const next = [...selected];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setSelected(next);
    if (mode === 'replace') setCursor(index + delta);
    setNotice(t('順番を変更しました', 'Order changed'));
  }
  function undoChange() {
    if (!undo) return;
    setSelected(undo.selected); setCursor(undo.cursor); setMode(undo.mode); setUndo(null); setCopied(false);
    setNotice(t('ひとつ前に戻しました', 'Last change undone'));
  }
  async function copy() {
    try { await navigator.clipboard.writeText(sequence); setCopied(true); setNotice(t('コピーしました', 'Copied')); }
    catch { setNotice(t('コピーできませんでした。下の絵文字列を選択してコピーしてください。', 'Copy failed. Select and copy the emoji text below.')); }
  }
  function applyExample(keyword: string) {
    setQuery(keyword); setCategory(''); setBrowse(false); searchRef.current?.focus();
  }

  function selection(inPalette: boolean) {
    return <div className={`selection ${inPalette ? 'selection-compact' : ''}`} data-testid={inPalette ? 'palette-selection' : 'page-selection'}>
      {Array.from({ length: 5 }, (_, index) => {
        const entry = byId.get(selected[index]);
        const active = inPalette && cursor === index;
        return <div className={`slot-wrap ${active ? 'is-target' : ''}`} key={index}>
          <span className="slot-number">{String(index + 1).padStart(2, '0')}</span>
          {entry ? <>
            <button type="button" className={`slot filled ${active && mode === 'replace' ? 'replacing' : ''}`} aria-label={t(`${index + 1}個目の${label(entry)}を置き換える`, `Replace emoji ${index + 1}: ${label(entry)}`)} onClick={() => inPalette ? (setMode('replace'), setCursor(index)) : launch(index, 'replace')}><span>{entry.emoji}</span></button>
            <button className="remove" type="button" aria-label={t(`${index + 1}個目の${label(entry)}を削除`, `Remove emoji ${index + 1}: ${label(entry)}`)} onClick={() => remove(index)}><X size={12} /></button>
            <div className="move-buttons">
              <button disabled={index === 0} aria-label={t(`${index + 1}個目を左へ`, `Move emoji ${index + 1} left`)} onClick={() => move(index, -1)}><ArrowLeft size={11} /></button>
              <button disabled={index === selected.length - 1} aria-label={t(`${index + 1}個目を右へ`, `Move emoji ${index + 1} right`)} onClick={() => move(index, 1)}><ArrowRight size={11} /></button>
            </div>
            {selected.length < 5 && <button className="insert-before" aria-label={t(`${index + 1}番目に挿入`, `Insert at position ${index + 1}`)} title={t('この前に追加', 'Insert before')} onClick={() => inPalette ? (setMode('insert'), setCursor(index)) : launch(index, 'insert')}><Plus size={11} /></button>}
          </> : <button className={`slot empty ${active ? 'active' : ''}`} aria-label={t(`${index + 1}個目のプラスを開く`, `Open plus ${index + 1}`)} onClick={() => inPalette ? (setMode('insert'), setCursor(selected.length), searchRef.current?.focus()) : launch(index, 'insert')}><Plus size={inPalette ? 22 : 27} strokeWidth={1.4} /></button>}
        </div>;
      })}
    </div>;
  }
  function tile(entry: EmojiEntry, keyPrefix = '') {
    const count = selected.filter(id => id === entry.id).length;
    return <button className={`emoji-tile ${count ? 'chosen' : ''}`} key={keyPrefix + entry.id} disabled={full} onClick={() => choose(entry)} title={label(entry)} aria-label={t(`${label(entry)} ${entry.emoji}を${mode === 'replace' ? '選択' : '追加'}`, `${mode === 'replace' ? 'Choose' : 'Add'} ${label(entry)} ${entry.emoji}`)}>
      <span className="emoji-glyph" aria-hidden="true">{entry.emoji}</span>
      <span className="emoji-label">{label(entry)}</span>
      {jevIds.has(entry.id) && <span className="jev-pick" title={t('Jevが提案', 'Suggested by Jev')}><Sparkles size={9} /></span>}
      {count > 0 && <span className="selected-count" aria-label={t(`${count}個選択済み`, `${count} selected`)}>{count}</span>}
    </button>;
  }

  return <>
    <header className="site-header">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="fanmark.id"><img src={brand} alt="" />fanmark<span>.id</span></a>
      <div className="header-tools"><span className="preview-badge">PALETTE PREVIEW</span><button className="language-button" onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')} aria-label={t('Switch to English', '日本語に切り替え')}><Globe2 size={16} />{language === 'ja' ? 'EN' : '日本語'}</button></div>
    </header>
    <main className="stage">
      <section className="intro">
        <div className="eyebrow"><span />{t('ことばから、あなたのファンマへ。', 'FROM WORDS TO YOUR FANMARK.')}</div>
        <h1>{t('「これだ」が見つかる、', 'Find your kind')}<br /><span>{t('絵文字えらび。', 'of emoji.')}</span></h1>
        <p className="lead">{t('名前がわからなくても、大丈夫。', 'You don’t need to know its name.')}<br />{t('好きなもの、気分、思いついた言葉から。', 'Start with a feeling, a favorite, or a little idea.')}</p>
        <div className="floating-note"><span className="note-emoji">💈</span><span>{t('たとえば「美容室」なら…', 'Try “hair salon”…')}<strong>💈 ＋ ✂️ ＋ 💇</strong></span><span className="note-spark">✦</span></div>
        <p className="intro-caption">{t('右の「＋」を押して、試してみてください。', 'Tap a plus to try the new palette.')}</p>
      </section>
      <section className="editor-card" aria-label={t('ファンマ入力のサンプル', 'Fanmark input preview')}>
        <div className="card-top"><span className="pill"><Sparkles size={13} />{t('あなただけの組み合わせ', 'A combination that’s yours')}</span><span className="counter">{selected.length}<span> / 5</span></span></div>
        <h2>{t('あなたのファンマをつくろう', 'Make it your fanmark')}</h2>
        <p className="muted">{t('絵文字は5つまで。組み合わせは、自由。', 'Up to five emojis. Endless possibilities.')}</p>
        {selection(false)}
        <div className="url-preview"><span>fanmark.id /</span><span className="url-emoji">{sequence || '…'}</span></div>
        <div className="editor-actions"><button className="text-button" disabled={!selected.length} onClick={clearSelection}>{t('すべてクリア', 'Clear all')}</button><button className="copy-button" disabled={!selected.length} onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? t('コピーしました', 'Copied') : t('入力をコピー', 'Copy emojis')}</button></div>
        <div className="sample-divider" /><div className="try-label">{t('こんな言葉で探してみる', 'A little inspiration')}</div>
        <div className="example-cards">{[{ query: examples[0], emoji: '💈', color: 'pink' }, { query: examples[1], emoji: '☕', color: 'cream' }, { query: examples[3], emoji: '🪐', color: 'mint' }].map(item => <button className={`example-card ${item.color}`} key={item.query} onClick={() => launch(selected.length, 'insert', item.query)}><span>{item.emoji}</span><span>{item.query}</span><ArrowRight size={14} /></button>)}</div>
      </section>
    </main>
    <footer className="page-footer"><span>✦ fanmark.id</span><p>{t('Web版パレットの操作サンプル。辞書検索にJevの候補提案を追加。空き状況確認・取得処理には接続していません。', 'Web palette prototype. Dictionary search with Jev suggestions. Availability checks and registration are not connected.')}</p></footer>
    <div className="sr-only" role="status" aria-live="polite">{notice}</div>
    {!open && notice && <div className="page-notice" role="status">{notice}</div>}

    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="palette-overlay" />
        <Dialog.Content className="palette" onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); lastTrigger.current?.focus(); }}>
          <div className="palette-head"><div className="palette-symbol"><Sparkles size={21} /></div><div><Dialog.Title>{t('ぴったりの絵文字を。', 'Find the right emoji.')}</Dialog.Title><Dialog.Description>{t('名前でも、気分でも。思いつく言葉でどうぞ。', 'A name, a feeling, or whatever comes to mind.')}</Dialog.Description></div><Dialog.Close className="icon-button close" aria-label={t('パレットを閉じる', 'Close palette')}><X size={19} /></Dialog.Close></div>
          <div className="search-area">
            <div className="search-box"><Search size={20} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onCompositionStart={() => { composing.current = true; setIsComposing(true); }} onCompositionEnd={() => { composing.current = false; setIsComposing(false); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return; document.querySelector<HTMLButtonElement>('.results-grid .emoji-tile:not(:disabled)')?.focus(); } }} placeholder={t('例：美容室、春っぽい、coffee', 'Try hair salon, spring, or カフェ')} aria-label={t('絵文字を検索', 'Search emojis')} autoComplete="off" autoCorrect="off" spellCheck={false} />{query ? <button className="icon-button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label={t('検索語をクリア', 'Clear search')}><X size={17} /></button> : <span className="search-hint">JA / EN</span>}</div>
            <div className="query-chips">{examples.map(word => <button key={word} className={query === word ? 'active' : ''} onClick={() => applyExample(word)}>{word}</button>)}</div>
            <div className="jev-controls"><label><input type="checkbox" checked={jevEnabled} onChange={event => setJevEnabled(event.target.checked)} /><Sparkles size={12} />{t('Jevで候補を探す', 'Find suggestions with Jev')}</label><span className={`jev-status ${jev.status}`} role="status">{jev.status === 'loading' ? <><Loader2 size={12} className="spin" />{t('候補を探しています', 'Finding suggestions')}</> : jev.status === 'ready' ? <>{jev.ids.length ? t('Jev反映済み', 'Jev suggestions ready') : t('Jevの追加候補なし', 'No extra Jev suggestions')} · {jev.cached ? t('キャッシュ', 'cached') : `${(jev.elapsedMs! / 1000).toFixed(2)}s`}</> : jev.status === 'error' ? t(jev.error === 'rate_limit' || jev.error === 'provider_rate_limit' ? '混雑中・辞書候補を表示' : 'Jevに接続できません・辞書候補を表示', 'Jev unavailable · dictionary results') : !jevEnabled ? t('辞書のみで検索', 'Dictionary only') : [...query.trim()].length > 160 ? t('Jevは160文字まで', 'Jev supports up to 160 characters') : isComposing ? t('変換確定後に検索', 'Waiting for composition') : t('2文字以上で検索', 'Type at least 2 characters')}</span></div>
            {jevEnabled && <p className="jev-disclosure">{t('検索語をTypeSafe AI（Jev）へ送信します。履歴・入力済み絵文字は送信しません。', 'Search text is sent to TypeSafe AI (Jev). History and selected emojis stay here.')}</p>}
          </div>
          <section className="selected-area" aria-label={t('入力中の絵文字', 'Your selection')}>
            <div className="selection-topline"><span>{t('入力中', 'YOUR FANMARK')} <b>{selected.length} / 5</b></span><div className="selection-actions"><button type="button" className="clear-selection-button" disabled={!selected.length} onClick={clearSelection}>{t('すべてクリア', 'Clear all')}</button><button className="undo-button" disabled={!undo} onClick={undoChange}><Undo2 size={13} />{t('ひとつ戻す', 'Undo')}</button></div></div>
            {selection(true)}
            <div className={`selection-hint ${full ? 'at-limit' : ''}`} aria-live="polite">{full ? t('5つ選びました。×で削除すると、また追加できます。', 'All 5 slots are filled. Remove one to keep adding.') : mode === 'replace' ? t(`${cursor + 1}個目を置き換えます`, `Replace emoji ${cursor + 1}`) : <><span className="cursor-dot" />{t(`次は${cursor + 1}個目に追加。続けて選べます。`, `Adding at position ${cursor + 1}. Keep picking.`)}</>}{mode === 'replace' && <button onClick={() => { setMode('insert'); setCursor(selected.length); }}>{t('追加に戻る', 'Add instead')}</button>}</div>
          </section>
          <div className="result-controls"><div className="view-switch"><button className={!browse ? 'active' : ''} aria-pressed={!browse} onClick={() => { setBrowse(false); setCategory(''); }}>{t('見つける', 'Discover')}</button><button className={browse ? 'active' : ''} aria-pressed={browse} onClick={() => setBrowse(true)}>{t('すべて', 'Browse all')}</button></div><div className="category-select"><select aria-label={t('カテゴリ', 'Category')} value={category} onChange={event => { setCategory(event.target.value); setBrowse(true); }}><option value="">{t('すべてのカテゴリ', 'All categories')}</option>{categories.map(([key, ja, en]) => <option key={key} value={key}>{t(ja, en)}</option>)}</select><ChevronDown size={13} /></div></div>
          <div className="results-scroll" key={`${query}-${category}-${browse}-${variants}`}>
            {!searching && history.length > 0 && <section className="recent-section"><div className="result-title"><span><History size={14} />{t('最近選んだ絵文字', 'Recently picked')}</span><button className="text-button" onClick={() => setHistory([])}>{t('履歴を消す', 'Clear history')}</button></div><div className="results-grid">{history.slice(0, 8).map(id => tile(byId.get(id)!, 'recent-'))}</div></section>}
            <div className="result-title"><span>{searching ? t(query.trim() ? 'ことばに合う候補' : '絵文字の一覧', query.trim() ? 'Matches for your words' : 'All emojis') : t('まずは、このあたりから', 'Start with something you love')}<small>{searching ? results.length.toLocaleString() : shown.length}{t('件', ' results')}</small></span>{query && <span className="match-kind">{jev.ids.length ? t('Jev ＋ 辞書', 'Jev + dictionary') : t('辞書検索', 'Dictionary')}</span>}</div>
            {shown.length > 0 ? <div className="results-grid">{shown.map(entry => tile(entry))}</div> : <div className="empty-state"><span>🔎</span><strong>{jev.status === 'loading' ? t('Jevがことばの意味から探しています。', 'Jev is looking beyond the dictionary.') : t('まだ、ぴったりが見つかりません。', 'No match just yet.')}</strong><p>{t('短い言葉や、見た目・別名でも試してみてください。', 'Try a shorter word, a description, or another name.')}</p><button onClick={() => { setQuery(''); setCategory(''); setBrowse(true); }}>{t('すべての絵文字を見る', 'Browse all emojis')}<ArrowRight size={14} /></button></div>}
            {searching && results.length > limit && <button className="load-more" onClick={() => setLimit(previous => previous + 64)}>{t('もっと表示', 'Show more')}<ChevronDown size={14} /></button>}
            <label className="variant-option"><input type="checkbox" checked={variants} onChange={event => setVariants(event.target.checked)} />{t('肌色のバリエーションも表示', 'Include skin tone variations')}</label>
            {!historySaved && <p className="storage-note">{t('このブラウザーでは履歴を保存できません。', 'History cannot be saved in this browser.')}</p>}
          </div>
          <div className="palette-footer"><div><span className="local-dot" />{jevEnabled ? t('Jev ＋ この端末の辞書', 'Jev + local dictionary') : t('この端末で検索', 'Searches on this device')}<small>{catalog.length.toLocaleString()}{t('件のカタログ', ' emoji catalog')}</small></div><Dialog.Close className="done-button">{t('完了', 'Done')}<Check size={15} /></Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
