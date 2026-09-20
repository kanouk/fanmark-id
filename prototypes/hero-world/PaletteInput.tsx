import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, History, Plus, Search, Sparkles, Loader2, Undo2, X } from 'lucide-react';
import { byId, catalog, categories, findEmoji, recommended, searchEmoji, type EmojiEntry } from '../emoji-palette/search';
import { useTranslation } from '../../src/hooks/useTranslation';
import type { EmojiInputProps } from '../../src/components/EmojiInput';
import { canonicalizeEmojiString, segmentEmojiSequence } from '../../src/lib/emojiConversion';
import { useJevSearch } from '../emoji-palette/useJevSearch';

const HISTORY_KEY = 'fanmark.palette-prototype.history.v1';
const loadHistory = (): string[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(stored) ? [...new Set(stored.filter((id): id is string => typeof id === 'string' && byId.has(id)))].slice(0, 24) : [];
  } catch { return []; }
};
type Mode = 'insert' | 'replace';
type Snapshot = { selected: string[]; cursor: number; mode: Mode };

export function PaletteInput({value, onChange, onSearchPerformed, disabled = false, utilities, selectionStatus, acquisition}: EmojiInputProps) {
  const { language } = useTranslation();
  const selected = useMemo(() => segmentEmojiSequence(canonicalizeEmojiString(value)).slice(0, 5).map(emoji => findEmoji(emoji)?.id ?? `literal:${emoji}`), [value]);
  const entryFor = (id: string): EmojiEntry | undefined => byId.get(id) ?? (id?.startsWith('literal:') ? {id, emoji:id.slice(8), name:id.slice(8), ja:id.slice(8), category:'', subcategory:'',words:[],variant:false} : undefined);
  const lastEmitted = useRef<string | null>(null);
  const setSelected = (ids:string[]) => {
    const next=canonicalizeEmojiString(ids.slice(0,5).map(id=>entryFor(id)?.emoji ?? '').join(''));
    lastEmitted.current=next;
    onChange(next); onSearchPerformed?.(next);
  };
  const dragged = useRef<number | null>(null);
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
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
  useEffect(() => {
    const canonical=canonicalizeEmojiString(value);
    if(lastEmitted.current!==canonical){setUndo(null);setCursor(segmentEmojiSequence(canonical).length);setMode('insert');}
    lastEmitted.current=canonical;
  }, [value]);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [historySaved, setHistorySaved] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  const t = (ja: string, en: string) => language === 'ja' ? ja : en;
  const label = (entry: EmojiEntry) => language === 'ja' ? entry.ja : entry.name;
  const sequence = selected.map(id => entryFor(id)!.emoji).join('');
  const full = selected.length === 5 && mode === 'insert';
  const dictionaryResults = useMemo(() => searchEmoji(query, category, variants), [query, category, variants]);
  const jev = useJevSearch(query, category, variants, jevEnabled && open, isComposing);
  const results = useMemo(() => [...new Map([
    ...jev.ids.map(id => byId.get(id)!), ...dictionaryResults,
  ].map(entry => [entry.id, entry])).values()], [jev.ids, dictionaryResults]);
  const jevIds = new Set(jev.ids);
  const searching = Boolean(query.trim() || browse || category);
  const shown = searching ? results.slice(0, limit) : recommended;

  useEffect(() => { setLimit(64); }, [query, category, variants]);
  useEffect(() => { if (!notice)return;const timeout=window.setTimeout(()=>setNotice(''),2500);return()=>clearTimeout(timeout); }, [notice]);
  useEffect(() => {
    setCursor(previous=>Math.min(previous,selected.length));
    if(!selected.length)setMode('insert');
  }, [selected.length]);
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
    if (disabled) return;
    lastTrigger.current = document.activeElement as HTMLElement;
    setMode(nextMode);
    setCursor(Math.min(index, selected.length));
    if (keyword !== undefined) { setQuery(keyword); setCategory(''); setBrowse(false); }
    setOpen(true);
  }
  function remember() { setUndo({ selected: [...selected], cursor, mode }); setCopied(false); }
  function choose(entry: EmojiEntry) {
    if (full || disabled) return;
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
    if (disabled) return;
    remember();
    const next = selected.filter((_, position) => position !== index);
    setSelected(next);
    if (mode === 'replace' && cursor === index) {
      setMode('insert'); setCursor(Math.min(index, next.length));
    } else setCursor(Math.min(cursor - (index < cursor ? 1 : 0), next.length));
    setNotice(t('絵文字を削除しました', 'Emoji removed'));
  }
  function clearSelection() {
    if (!selected.length || disabled) return;
    remember();
    setSelected([]); setCursor(0); setMode('insert');
    setNotice(t('入力中の絵文字をすべてクリアしました', 'All selected emojis cleared'));
  }
  function move(index: number, delta: number) {
    if (disabled || index + delta < 0 || index + delta >= selected.length) return;
    remember();
    const next = [...selected];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setSelected(next);
    if (mode === 'replace') setCursor(index + delta);
    setNotice(t('順番を変更しました', 'Order changed'));
  }
  function undoChange() {
    if (!undo || disabled) return;
    setSelected(undo.selected); setCursor(undo.cursor); setMode(undo.mode); setUndo(null); setCopied(false);
    setNotice(t('ひとつ前に戻しました', 'Last change undone'));
  }
  async function copy() {
    try { await navigator.clipboard.writeText(sequence); setCopied(true); setNotice(t('コピーしました', 'Copied')); }
    catch { setNotice(t('コピーできませんでした。下の絵文字列を選択してコピーしてください。', 'Copy failed. Select and copy the emoji text below.')); }
  }

  function endDrag() {
    dragged.current = null;
    setDragSource(null);
    setDropTarget(null);
  }
  function startDrag(event: React.DragEvent<HTMLButtonElement>, index: number) {
    dragged.current = index;
    setDragSource(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
  function dragOver(event: React.DragEvent<HTMLButtonElement>, index: number) {
    if (disabled || dragged.current === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(index);
  }
  function drop(event: React.DragEvent<HTMLButtonElement>, index: number) {
    event.preventDefault();
    const from = dragged.current;
    endDrag();
    if (disabled || from === null || from === index) return;
    remember();
    const next = [...selected];
    const [item] = next.splice(from, 1);
    const destination = Math.min(index, next.length);
    next.splice(destination, 0, item);
    setSelected(next);
    if (mode === 'replace') setCursor(destination);
    setNotice(t('順番を変更しました', 'Order changed'));
  }

  function selection(inPalette: boolean) {
    return <div className={`selection ${inPalette ? 'selection-compact' : ''}`} data-testid={inPalette ? 'palette-selection' : 'page-selection'}>
      {Array.from({ length: 5 }, (_, index) => {
        const entry = entryFor(selected[index]);
        const active = inPalette && cursor === index;
        return <div className={`slot-wrap ${active ? 'is-target' : ''} ${dragSource === index ? 'is-dragging' : ''} ${dropTarget === index && dragSource !== index ? 'is-drop-target' : ''}`} key={index}>
          <span className="slot-number">{String(index + 1).padStart(2, '0')}</span>
          {entry ? <>
            <button type="button" disabled={disabled} draggable={!disabled} onDragStart={event => startDrag(event, index)} onDragEnd={endDrag} onDragOver={event => dragOver(event, index)} onDrop={event=>drop(event,index)} className={`slot filled ${active && mode === 'replace' ? 'replacing' : ''}`} aria-label={t(`${index + 1}個目の${label(entry)}を置き換える`, `Replace emoji ${index + 1}: ${label(entry)}`)} onClick={() => inPalette ? (setMode('replace'), setCursor(index)) : launch(index, 'replace')}><span>{entry.emoji}</span></button>
            <button disabled={disabled} className="remove" type="button" aria-label={t(`${index + 1}個目の${label(entry)}を削除`, `Remove emoji ${index + 1}: ${label(entry)}`)} onClick={() => remove(index)}><X size={12} /></button>
            <div className="move-buttons">
              <button disabled={disabled || index === 0} aria-label={t(`${index + 1}個目を左へ`, `Move emoji ${index + 1} left`)} onClick={() => move(index, -1)}><ArrowLeft size={11} /></button>
              <button disabled={disabled || index === selected.length - 1} aria-label={t(`${index + 1}個目を右へ`, `Move emoji ${index + 1} right`)} onClick={() => move(index, 1)}><ArrowRight size={11} /></button>
            </div>
          </> : <button disabled={disabled} onDragOver={event => dragOver(event, index)} onDrop={event=>drop(event,index)} className={`slot empty ${active ? 'active' : ''}`} aria-label={t(`${index + 1}個目のプラスを開く`, `Open plus ${index + 1}`)} onClick={() => inPalette ? (setMode('insert'), setCursor(selected.length), searchRef.current?.focus()) : launch(index, 'insert')}><Plus size={inPalette ? 22 : 27} strokeWidth={1.4} /></button>}
        </div>;
      })}
    </div>;
  }
  function tile(entry: EmojiEntry, keyPrefix = '') {
    const count = selected.filter(id => id === entry.id).length;
    return <button className={`emoji-tile ${count ? 'chosen' : ''}`} key={keyPrefix + entry.id} disabled={full || disabled} onClick={() => choose(entry)} title={label(entry)} aria-label={t(`${label(entry)} ${entry.emoji}を${mode === 'replace' ? '選択' : '追加'}`, `${mode === 'replace' ? 'Choose' : 'Add'} ${label(entry)} ${entry.emoji}`)}>
      <span className="emoji-glyph" aria-hidden="true">{entry.emoji}</span>
      <span className="emoji-label">{label(entry)}</span>
      {jevIds.has(entry.id) && <span className="jev-pick" title={t('Jevが提案', 'Suggested by Jev')}><Sparkles size={9} /></span>}
      {count > 0 && <span className="selected-count" aria-label={t(`${count}個選択済み`, `${count} selected`)}>{count}</span>}
    </button>;
  }

  return <div className="fanmark-palette">
    <div className="composer-layout"><div className="integrated-editor">
      <div className="editor-topline"><p>{t('＋から絵文字を選ぶ', 'Choose emojis with +')}</p><span className="counter" aria-label={t(`${selected.length}個選択済み、最大5個`, `${selected.length} of 5 emojis selected`)}>{selected.length}<span> / 5</span></span></div>
      {selection(false)}
      <div className="input-toolbar" role="group" aria-label={t('入力の操作', 'Edit your selection')}>
        <div className="input-utilities">{utilities?.(clearSelection)}</div>
        <button className="undo-button" disabled={!undo || disabled} onClick={undoChange}><Undo2 size={15}/>{t('元に戻す', 'Undo')}</button>
      </div>
      <div className="quiet-address"><span className="quiet-domain">fanmark.id/</span><span className="quiet-emojis">{sequence || '…'}</span><button disabled={!selected.length} onClick={copy} aria-label={t('絵文字をコピー', 'Copy emojis')} title={t('絵文字をコピー', 'Copy emojis')}>{copied ? <Check size={15}/> : <Copy size={15}/>}</button></div>
    </div>
    <div className="acquisition-panel">
      <div className="decision-heading">{t('このファンマを使う', 'Make it yours')}</div>
      <div className="decision-status" aria-live="polite">{selectionStatus || <span>{selected.length ? t('空き状況を確認中…', 'Checking availability…') : t('絵文字を選ぶと、取得に進めます', 'Choose emojis to get started')}</span>}</div>
      {acquisition?.(() => launch(selected.length < 5 ? selected.length : 0, selected.length < 5 ? 'insert' : 'replace'))}
    </div></div>
    <div className="sr-only" role="status" aria-live="polite">{notice}</div>
    {!open && notice && <div className="page-notice" role="status">{notice}</div>}

    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <div className="fanmark-palette">
        <Dialog.Overlay className="palette-overlay" />
        <Dialog.Content className="palette" onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); lastTrigger.current?.focus(); }}>
          <div className="palette-head"><div className="palette-symbol"><Sparkles size={21} /></div><div><Dialog.Title>{t('ぴったりの絵文字を。', 'Find the right emoji.')}</Dialog.Title><Dialog.Description>{t('名前でも、気分でも。思いつく言葉でどうぞ。', 'A name, a feeling, or whatever comes to mind.')}</Dialog.Description></div><Dialog.Close className="icon-button close" aria-label={t('パレットを閉じる', 'Close palette')}><X size={19} /></Dialog.Close></div>
          <div className="search-area">
            <div className="search-box"><Search size={20} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onCompositionStart={() => { composing.current = true; setIsComposing(true); }} onCompositionEnd={() => { composing.current = false; setIsComposing(false); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return; searchRef.current?.closest('.palette')?.querySelector<HTMLButtonElement>('.results-grid .emoji-tile:not(:disabled)')?.focus(); } }} placeholder={t('例：美容室、春っぽい、coffee', 'Try hair salon, spring, or カフェ')} aria-label={t('絵文字を検索', 'Search emojis')} autoComplete="off" autoCorrect="off" spellCheck={false} />{query ? <button className="icon-button" onClick={() => { setQuery(''); searchRef.current?.focus(); }} aria-label={t('検索語をクリア', 'Clear search')}><X size={17} /></button> : <span className="search-hint">JA / EN</span>}</div>
              <div className="jev-controls"><label><input type="checkbox" checked={jevEnabled} onChange={event => setJevEnabled(event.target.checked)} /><Sparkles size={12} />{t('Jevで候補を探す', 'Find suggestions with Jev')}</label><span className={`jev-status ${jev.status}`} role="status">{jev.status === 'loading' ? <><Loader2 size={12} className="spin" />{t('候補を探しています', 'Finding suggestions')}</> : jev.status === 'ready' ? <>{jev.ids.length ? t('Jev反映済み', 'Jev suggestions ready') : t('Jevの追加候補なし', 'No extra Jev suggestions')} · {jev.cached ? t('キャッシュ', 'cached') : `${(jev.elapsedMs! / 1000).toFixed(2)}s`}</> : jev.status === 'error' ? t(jev.error === 'rate_limit' || jev.error === 'provider_rate_limit' ? '混雑中・辞書候補を表示' : 'Jevに接続できません・辞書候補を表示', 'Jev unavailable · dictionary results') : !jevEnabled ? t('辞書のみで検索', 'Dictionary only') : [...query.trim()].length > 160 ? t('Jevは160文字まで', 'Jev supports up to 160 characters') : isComposing ? t('変換確定後に検索', 'Waiting for composition') : t('2文字以上で検索', 'Type at least 2 characters')}</span></div>
            {jevEnabled && <p className="jev-disclosure">{t('検索語をTypeSafe AI（Jev）へ送信します。履歴・入力済み絵文字は送信しません。', 'Search text is sent to TypeSafe AI (Jev). History and selected emojis stay here.')}</p>}
          </div>
          <section className="selected-area" aria-label={t('入力中の絵文字', 'Your selection')}>
            <div className="selection-topline"><span>{t('入力中', 'YOUR FANMARK')} <b>{selected.length} / 5</b></span><div className="selection-actions"><button type="button" className="clear-selection-button" disabled={!selected.length || disabled} onClick={clearSelection}>{t('すべてクリア', 'Clear all')}</button><button className="undo-button" disabled={!undo || disabled} onClick={undoChange}><Undo2 size={13} />{t('ひとつ戻す', 'Undo')}</button></div></div>
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
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
