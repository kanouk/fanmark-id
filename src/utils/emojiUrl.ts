/**
 * 絵文字URL処理のユーティリティ関数
 * 複合絵文字や特殊文字を含むURLの正規化と適切な表示を処理
 */

/**
 * 絵文字をURL安全な形式にエンコード
 * ブラウザの自動エンコーディングに対応
 */
const EMOJI_ONLY_REGEX = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}\u200D\uFE0F]+$/u;
const COMPLEX_EMOJI_REGEX = /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}))*|\p{Regional_Indicator}{2}|[^\s\uFE0F\u200D]/gu;

export const isEmojiOnly = (candidate: string | null | undefined): boolean => {
  if (!candidate) return false;
  const value = candidate.trim();
  if (value.length === 0) return false;

  return EMOJI_ONLY_REGEX.test(value);
};

export const splitEmojiGraphemes = (input: string): string[] => {
  if (!input) return [];

  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const segmenter = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(input), (segment: any) => segment.segment);
  }

  return input.match(COMPLEX_EMOJI_REGEX) || [];
};

export const encodeEmojiForUrl = (emoji: string): string => {
  if (!emoji) return '';

  try {
    // Unicode正規化 (NFC)
    const normalized = emoji.normalize('NFC');

    // 連続するVariation Selector-16 (U+FE0F)を単一化
    const cleanedUp = normalized.replace(/\uFE0F+/g, '\uFE0F');

    // URLエンコード
    return encodeURIComponent(cleanedUp);
  } catch (error) {
    console.error('Error encoding emoji for URL:', error);
    return encodeURIComponent(emoji);
  }
};

/**
 * URL安全な絵文字をデコードして元の絵文字に復元
 */
export const decodeEmojiFromUrl = (encodedEmoji: string): string => {
  if (!encodedEmoji) return '';

  try {
    // URLデコード
    let decoded = decodeURIComponent(encodedEmoji);

    // Unicode正規化 (NFC)
    const normalized = decoded.normalize('NFC');

    // 連続するVariation Selector-16 (U+FE0F)を単一化
    const cleanedUp = normalized.replace(/\uFE0F+/g, '\uFE0F');

    return cleanedUp;
  } catch (error) {
    console.error('Error decoding emoji from URL:', error);
    return encodedEmoji;
  }
};

/**
 * ファンマURL用の正規化処理
 * FanmarkAccess.tsxのnormalizeEmojiPath関数を統合
 */
export const normalizeEmojiPath = (path: string): string => {
  if (!path) return '';

  console.log('🔍 Normalizing emoji path:', { original: path, length: path.length });

  try {
    // Step 1: 安全なデコード（エンコード判定つき）
    let decoded = path;
    try {
      const testDecode = decodeURIComponent(path);
      if (testDecode !== path) {
        decoded = testDecode;
        console.log('📝 Decoded from percent-encoding:', { decoded });
      }
    } catch {
      // デコードエラーの場合はそのまま使用
    }

    // Step 2: Edge Functionと同じ正規化ロジック
    // Remove skin tone modifiers (U+1F3FB-U+1F3FF) to match server-side normalization
    const SKIN_TONE_MODIFIER_GLOBAL_REGEX = /\p{Emoji_Modifier}/gu;
    const normalizedForDatabase = decoded.replace(SKIN_TONE_MODIFIER_GLOBAL_REGEX, '');

    console.log('✨ Final normalized emoji (matches database):', {
      original: path,
      decoded,
      normalizedForDatabase,
      finalLength: normalizedForDatabase.length
    });

    return normalizedForDatabase;
  } catch (error) {
    console.error('❌ Emoji normalization error:', error, { path });
    return path;
  }
};

/**
 * ブラウザのアドレスバーでの表示用にURLを構築
 * HTML5 History APIを使用してアドレスバーの表示を制御
 */
export const getDisplayUrl = (emoji: string, baseUrl?: string): string => {
  if (!emoji) return '';

  const base = baseUrl || window.location.origin;

  // 絵文字をそのまま使用（ブラウザが適切に処理）
  return `${base}/${emoji}`;
};

/**
 * ファンマURLへの安全なナビゲーション
 * ブラウザのアドレスバーに絵文字が表示されるように処理
 */
export const navigateToFanmark = (emoji: string, openInNewTab = false): void => {
  if (!emoji) return;

  const url = `/${emoji}`;

  if (openInNewTab) {
    // 新しいタブで開く
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    // 同一タブでナビゲート
    window.location.href = url;
  }
};

/**
 * クリップボードコピー用のURL生成
 * 絵文字をそのまま含むURLを生成
 */
export const getFanmarkUrlForClipboard = (emoji: string, baseUrl?: string): string => {
  if (!emoji) return '';

  const base = baseUrl || window.location.origin;
  return `${base}/${emoji}`;
};

export const getFanmarkShortUrl = (shortId: string, baseUrl?: string): string => {
  if (!shortId) return '';

  const base = baseUrl || window.location.origin;
  return `${base}/a/${shortId}`;
};

/**
 * URLからアドレスバーの表示を更新
 * History APIを使用してエンコードされたURLを絵文字表示に変更
 */
export const updateAddressBarDisplay = (emoji: string): void => {
  if (!emoji || !window.history || !window.history.replaceState) return;

  try {
    const newUrl = `/${emoji}`;
    const currentPath = window.location.pathname;

    // 現在のパスと異なる場合のみ更新
    if (currentPath !== newUrl) {
      window.history.replaceState(
        window.history.state,
        document.title,
        newUrl
      );
    }
  } catch (error) {
    console.error('Error updating address bar display:', error);
  }
};
