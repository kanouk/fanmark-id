/**
 * OAuth 招待コード処理のヘルパー関数
 * localStorage を使用して OAuth リダイレクト中の招待コード情報を保持
 */

const PENDING_INVITATION_CODE_KEY = 'pending_invitation_code';

/**
 * OAuth フロー開始前に招待コードを localStorage に保存
 * @param invitationCode - 検証済みの招待コード（null/undefined の場合は何もしない）
 */
export const saveInvitationCodeForOAuth = (invitationCode?: string | null): void => {
  if (!invitationCode) return;
  
  try {
    const normalized = invitationCode.trim().toUpperCase();
    localStorage.setItem(PENDING_INVITATION_CODE_KEY, normalized);
  } catch (error) {
    console.warn('Failed to save invitation code to localStorage:', error);
  }
};

/**
 * localStorage から保留中の招待コードをクリア
 * OAuth エラー時、または招待コード処理完了時に呼び出す
 */
export const clearPendingInvitationCode = (): void => {
  try {
    localStorage.removeItem(PENDING_INVITATION_CODE_KEY);
  } catch (error) {
    console.warn('Failed to clear pending invitation code from localStorage:', error);
  }
};

/**
 * localStorage から保留中の招待コードを取得
 * @returns 保存されている招待コード（存在しない場合は null）
 */
export const getPendingInvitationCode = (): string | null => {
  try {
    return localStorage.getItem(PENDING_INVITATION_CODE_KEY);
  } catch (error) {
    console.warn('Failed to get pending invitation code from localStorage:', error);
    return null;
  }
};
