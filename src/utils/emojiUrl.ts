/**
 * 絵文字URL処理のユーティリティ関数
 * 複合絵文字や特殊文字を含むURLの正規化と適切な表示を処理
 */

/**
 * 絵文字をURL安全な形式にエンコード
 * ブラウザの自動エンコーディングに対応
 */
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

    // Step 2: Unicode NFC 正規化
    const normalized = decoded.normalize('NFC');

    // Step 3: 連続する Variation Selector-16 (U+FE0F) を単一化
    const cleanedUp = normalized.replace(/\uFE0F+/g, '\uFE0F');

    console.log('✨ Final normalized emoji:', {
      original: path,
      decoded,
      normalized,
      cleanedUp,
      finalLength: cleanedUp.length
    });

    return cleanedUp;
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