import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, ArrowLeft, ArrowRight, Undo2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useTranslation } from "@/hooks/useTranslation";
import {
  getInstalledEmojiCatalog,
  canonicalizeEmojiString,
  segmentEmojiSequence,
} from "@/lib/emojiConversion";
import {
  makeSearchCatalog,
  searchEmoji,
  type Dictionary,
} from "../../../shared/emoji-palette/search";
import { loadPaletteDictionary } from "./palette-dictionary";
import { useJevSearch } from "./useJevSearch";
import { paletteCopy, categoryLabels } from "./palette-copy";

type Snapshot = { value: string; cursor: number; replace: boolean };
const HISTORY = "fanmark.palette.history.v1";
export default function EmojiPalette({
  value,
  onChange,
  initialIndex,
  onClose,
  onUndoUsed,
  disabled = false,
  maxLength = 5,
}: {
  value: string;
  onChange: (value: string) => void;
  initialIndex: number;
  onClose: () => void;
  onUndoUsed?: () => void;
  disabled?: boolean;
  maxLength?: number;
}) {
  const viewportRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      const dialog = viewportRoot.current?.closest<HTMLElement>(
        "[data-palette-dialog]",
      );
      if (dialog && viewport) {
        dialog.style.setProperty(
          "--palette-viewport-height",
          viewport.height + "px",
        );
        dialog.style.top = viewport.offsetTop + viewport.height / 2 + "px";
      }
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
    };
  }, []);
  const { language } = useTranslation(),
    t = paletteCopy(language);
  const [release] = useState(getInstalledEmojiCatalog);
  const [dictionary, setDictionary] = useState<Dictionary>({});
  const [dictionaryState, setDictionaryState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [dictionaryAttempt, setDictionaryAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setDictionaryState("loading");
    void loadPaletteDictionary().then(
      (data) => {
        if (alive) {
          setDictionary(data);
          setDictionaryState("ready");
        }
      },
      () => {
        if (alive) setDictionaryState("error");
      },
    );
    return () => {
      alive = false;
    };
  }, [dictionaryAttempt]);
  const catalog = useMemo(
    () => makeSearchCatalog(release.items, dictionary),
    [release, dictionary],
  );
  const byEmoji = useMemo(
    () => new Map(catalog.map((e) => [e.emoji, e])),
    [catalog],
  );
  const byId = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);
  const validIds = useMemo(
    () => new Set(release.items.map((e) => e.id)),
    [release],
  );
  const selected = useMemo(
    () => segmentEmojiSequence(canonicalizeEmojiString(value)),
    [value],
  );
  const maximum = Math.min(5, maxLength);
  const [cursor, setCursor] = useState(Math.min(initialIndex, selected.length));
  const [replace, setReplace] = useState(initialIndex < selected.length);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [variants, setVariants] = useState(false),
    [browse, setBrowse] = useState(false),
    [limit, setLimit] = useState(64);
  const [enabled, setEnabled] = useState(true),
    [composing, setComposing] = useState(false);
  const composingRef = useRef(false),
    lastEmitted = useRef(value);
  const [undo, setUndo] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(HISTORY) ?? "[]");
      return Array.isArray(v)
        ? [
            ...new Set(v.filter((id): id is string => typeof id === "string")),
          ].slice(0, 24)
        : [];
    } catch {
      return [];
    }
  });
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY, JSON.stringify(history));
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, [history]);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setUndo(null);
      setCursor(selected.length);
      setReplace(false);
    }
    lastEmitted.current = value;
  }, [value, selected.length]);
  useEffect(() => {
    setLimit(64);
  }, [query, category, variants, browse]);
  const jev = useJevSearch(
    query,
    category,
    variants,
    enabled,
    composing,
    release.version,
    validIds,
  );
  const lexical = useMemo(
    () => searchEmoji(catalog, query, category, variants),
    [catalog, query, category, variants],
  );
  const results = useMemo(
    () => [
      ...new Map(
        [...jev.ids.map((id) => byId.get(id)!).filter(Boolean), ...lexical].map(
          (e) => [e.id, e],
        ),
      ).values(),
    ],
    [jev.ids, byId, lexical],
  );
  const searching = !!(query.trim() || category || browse);
  const recommendations = [
    "🌸",
    "✨",
    "🫶",
    "☕",
    "🐈",
    "🌿",
    "🎀",
    "🪐",
    "🍓",
    "🧸",
    "🌷",
    "🫧",
    "🍀",
    "🦋",
    "🌙",
    "🐣",
  ]
    .map((e) => byEmoji.get(e))
    .filter(Boolean);
  const shown = (searching ? results : recommendations).slice(0, limit);
  const full = selected.length >= maximum && !replace;
  const label = (emoji: string) => {
    const e = byEmoji.get(emoji);
    return e?.labels?.[language] ?? e?.name ?? emoji;
  };
  const emit = (next: string[], nextCursor: number, nextReplace: boolean) => {
    if (disabled) return;
    setUndo({ value, cursor, replace });
    const v = canonicalizeEmojiString(next.join(""));
    lastEmitted.current = v;
    onChange(v);
    setCursor(nextCursor);
    setReplace(nextReplace);
  };
  function choose(id: string) {
    const entry = byId.get(id);
    if (!entry || full || disabled) return;
    const next = [...selected];
    if (replace) next[cursor] = entry.emoji;
    else next.splice(cursor, 0, entry.emoji);
    if (next.length > maximum) return;
    emit(next, replace ? cursor : cursor + 1, replace);
    setHistory((old) => [id, ...old.filter((v) => v !== id)].slice(0, 24));
    if (replace) onClose();
  }
  function remove(index: number) {
    const next = selected.filter((_, i) => i !== index);
    emit(
      next,
      Math.min(cursor - (index < cursor ? 1 : 0), next.length),
      replace && index !== cursor,
    );
  }
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= selected.length) return;
    const next = [...selected];
    const [e] = next.splice(from, 1);
    next.splice(to, 0, e);
    emit(next, replace ? to : Math.min(cursor, next.length), replace);
  }
  const dragged = useRef<number | null>(null);
  const tile = (id: string, prefix = "") => {
    const e = byId.get(id);
    if (!e) return null;
    return (
      <button
        type="button"
        key={prefix + id}
        data-palette-emoji={e.emoji}
        disabled={disabled || full}
        onClick={() => choose(id)}
        title={label(e.emoji)}
        aria-label={`${replace ? t("replace") : t("add")} ${label(e.emoji)} ${e.emoji}`}
        className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-transparent p-1 hover:border-primary/30 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
      >
        <span className="text-3xl" aria-hidden="true">
          {e.emoji}
        </span>
        <span className="line-clamp-1 w-full text-center text-[10px] text-muted-foreground">
          {label(e.emoji)}
        </span>
        {jev.ids.includes(id) && (
          <Sparkles aria-hidden="true" className="h-3 w-3 text-primary" />
        )}
      </button>
    );
  };
  return (
    <div
      ref={viewportRoot}
      data-emoji-palette
      className="flex min-h-0 h-[min(44rem,calc(var(--palette-viewport-height,100dvh)-5rem))] max-h-[calc(var(--palette-viewport-height,100dvh)-5rem)] flex-col gap-3 overflow-y-auto"
    >
      <div className="pr-8">
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription className="mt-1 text-xs">
          {t("description")}
        </DialogDescription>
      </div>
      <div className="flex gap-2">
        <Input
          data-palette-search
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("search")}
          placeholder={t("placeholder")}
          onCompositionStart={() => {
            composingRef.current = true;
            setComposing(true);
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            setComposing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (
                composingRef.current ||
                e.nativeEvent.isComposing ||
                e.keyCode === 229
              )
                return;
              e.currentTarget
                .closest("[data-emoji-palette]")
                ?.querySelector<HTMLButtonElement>(
                  "[data-palette-results] button:not(:disabled)",
                )
                ?.focus();
            }
          }}
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("clearQuery")}
            onClick={() => setQuery("")}
          >
            <X />
          </Button>
        )}
      </div>
      <div className="space-y-1 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t("jev")}
        </label>
        {enabled && <p className="text-muted-foreground">{t("disclosure")}</p>}
        <p role="status" data-jev-status={jev.status}>
          {composing
            ? t("composing")
            : jev.status === "loading"
              ? t("searching")
              : jev.status === "ready"
                ? jev.ids.length
                  ? t("ready")
                  : t("noSuggestions")
                : jev.status === "error"
                  ? t("unavailable")
                  : enabled
                    ? t("short")
                    : t("dictionary")}
        </p>
      </div>
      <section aria-label={t("selected")} className="rounded-xl border p-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            {t("selected")} {selected.length} / {maximum}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!selected.length || disabled}
              onClick={() => emit([], 0, false)}
            >
              {t("clear")}
            </button>
            <button
              type="button"
              disabled={!undo || disabled}
              onClick={() => {
                if (!undo) return;
                lastEmitted.current = undo.value;
                onChange(undo.value);
                setCursor(undo.cursor);
                setReplace(undo.replace);
                setUndo(null);
                onUndoUsed?.();
              }}
            >
              <Undo2 className="inline h-3 w-3" /> {t("undo")}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: maximum }, (_, i) => (
            <div key={i} className="min-w-0 text-center">
              <div
                className={`relative rounded-lg border ${cursor === i ? "border-primary bg-primary/10" : ""}`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  className="h-12 w-full text-2xl"
                  draggable={!!selected[i] && !disabled}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(i));
                    dragged.current = i;
                  }}
                  onDragEnd={() => {
                    dragged.current = null;
                  }}
                  onDragOver={(e) => {
                    if (dragged.current !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragged.current !== null)
                      move(dragged.current, Math.min(i, selected.length - 1));
                    dragged.current = null;
                  }}
                  aria-label={`${selected[i] ? t("replace") : t("add")} ${i + 1}`}
                  onClick={() => {
                    setCursor(Math.min(i, selected.length));
                    setReplace(i < selected.length);
                  }}
                >
                  {selected[i] ?? <Plus className="mx-auto h-5 w-5" />}
                </button>
                {selected[i] && (
                  <button
                    type="button"
                    disabled={disabled}
                    className="absolute -right-1 -top-1 rounded-full bg-background p-1"
                    aria-label={`${t("remove")} ${i + 1}`}
                    onClick={() => remove(i)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="mt-1 min-h-6 flex justify-between [&>button]:min-h-6 [&>button]:min-w-6">
                {selected[i] && (
                  <>
                    <button
                      type="button"
                      disabled={disabled || i === 0}
                      aria-label={`${t("left")} ${i + 1}`}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowLeft className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || i === selected.length - 1}
                      aria-label={`${t("right")} ${i + 1}`}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 min-h-8 text-xs" aria-live="polite">
          {full
            ? t("limit")
            : replace
              ? `${t("replace")} ${cursor + 1}`
              : `${t("insert")} (${cursor + 1})`}
          {replace && (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                setReplace(false);
                setCursor(selected.length);
              }}
            >
              {t("addInstead")}
            </button>
          )}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button
          size="sm"
          variant={browse ? "outline" : "secondary"}
          onClick={() => {
            setBrowse(false);
            setCategory("");
          }}
        >
          {t("discover")}
        </Button>
        <Button
          size="sm"
          variant={browse ? "secondary" : "outline"}
          onClick={() => setBrowse(true)}
        >
          {t("all")}
        </Button>
        <select
          className="min-w-0 max-w-full rounded border bg-background p-2"
          aria-label={t("category")}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setBrowse(true);
          }}
        >
          <option value="">{t("allCategories")}</option>
          {[...new Set(catalog.map((e) => e.category))]
            .filter(Boolean)
            .map((c) => (
              <option key={c} value={c}>
                {categoryLabels[c]?.[
                  language === "ja"
                    ? 0
                    : language === "ko"
                      ? 2
                      : language === "id"
                        ? 3
                        : 1
                ] ?? c}
              </option>
            ))}
        </select>
      </div>
      <div
        className="min-h-24 flex-1 overflow-y-auto overscroll-contain"
        data-palette-results
      >
        {!searching && history.some((id) => byId.has(id)) && (
          <section>
            <div className="flex justify-between text-xs">
              <span>{t("history")}</span>
              <button type="button" onClick={() => setHistory([])}>
                {t("clearHistory")}
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1 sm:grid-cols-8">
              {history
                .filter((id) => byId.has(id))
                .slice(0, 8)
                .map((id) => tile(id, "history"))}
            </div>
          </section>
        )}
        <div className="grid grid-cols-5 gap-1 sm:grid-cols-8">
          {shown.map((e) => tile(e.id))}
        </div>
        {!shown.length && <p className="py-5 text-sm">{t("empty")}</p>}
        {searching && results.length > limit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLimit((v) => v + 64)}
          >
            {t("more")}
          </Button>
        )}
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={variants}
            onChange={(e) => setVariants(e.target.checked)}
          />
          {t("variants")}
        </label>
        {dictionaryState === "loading" && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("dictionaryLoading")}
          </p>
        )}
        {dictionaryState === "error" && (
          <p className="mt-2 text-xs">
            {t("dictionaryError")}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => setDictionaryAttempt((v) => v + 1)}
            >
              {t("retry")}
            </button>
          </p>
        )}
        {historyError && <p className="mt-2 text-xs">{t("historyError")}</p>}
      </div>
      <div className="flex justify-between border-t pt-2 text-xs">
        <span>
          {catalog.length.toLocaleString()} · {t("dictionary")}
        </span>
        <Button size="sm" onClick={onClose}>
          {t("done")}
        </Button>
      </div>
    </div>
  );
}
