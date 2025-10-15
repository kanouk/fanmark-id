# お気に入り機能仕様メモ

## 概要
- ユーザーが「お気に入り」に登録したファンマを一覧表示する専用ページ `/favorites` を追加。
- ダッシュボード冒頭の統計カードにお気に入り数を表示し、同ページへの導線を設置。
- ナビゲーションメニューからもお気に入りページへ遷移可能。

## バックエンド
- `seq_key(uuid[])` を導入し、`fanmarks` 含む各テーブルで肌色正規化済みキーを一意に扱えるようにした。
- `fanmark_discoveries`（検索・お気に入りで観測された未取得ファンマを含むカタログ）、`fanmark_favorites`（ユーザー×seq_key のお気に入り）、`fanmark_events`（検索/お気に入りのイベントログ）を新設。
- RPC 群を追加／更新。
  - `record_fanmark_search(input_emoji_ids uuid[])`：検索時に discovery を UPSERT し `search_count` を加算。
  - `add_fanmark_favorite` / `remove_fanmark_favorite`：seq_key ベースでお気に入りの追加・削除と `favorite_count` メンテ。
  - `get_favorite_fanmarks`：discovery／fanmarks／ライセンス諸テーブルを結合して一覧表示用データを返却。
- 取得時にはトリガ／RPC で `fanmark_discoveries.fanmark_id` と `availability_status` を更新し、候補→本登録の整合を取る。
- RLS 方針
  - `fanmark_discoveries` は SELECT を全員許可（書き込みはセキュリティディファイナ RPC 経由）。
  - `fanmark_favorites` はユーザー自身のみ SELECT/INSERT/DELETE。
  - `fanmark_events` は service/admin のみ SELECT。
- `supabase/integrations/types.ts` を更新し、新テーブルと RPC の型を反映。

## フロントエンド
- `useFavoriteFanmarks` フックを新設。
  - React Query でデータを取得・キャッシュ。認証完了後にのみフェッチするため `enabled` オプションに対応。
  - `useInvalidateFavoriteFanmarks` でキャッシュ破棄可能。詳細ページのハートボタンでトグル後に再取得。
- お気に入りページ (`src/pages/Favorites.tsx`)：
  - ロード中は Skeleton、取得失敗時はエラー表示＋リトライ導線。
  - カード形式でファンマ名・短縮 ID・絵文字・ライセンス状況・保有者・お気に入り追加日を表示。
  - 詳細ページ (`/f/:shortId`) と公開 URL (`/<emoji>`) へのアクションボタンを配置。
  - 未ログイン時は `/auth` へリダイレクト。
- ダッシュボード (`FanmarkDashboard`)：
  - 新しい統計カードにお気に入り数を表示し、 `/favorites` への導線ボタンを追加。
  - カードは React Query のキャッシュを利用して最新状態と整合。
- ナビゲーションメニューに「お気に入り」リンクを追加。
- ファンマ検索/取得フロー (`FanmarkAcquisition`)：
  - 取得済み・未取得どちらの結果にも「ファンマアクセス」「ファンマページ」「お気に入りに追加/解除」ボタンを表示。
  - お気に入りトグルは `useFavoriteFanmarks` のキャッシュを参照しつつ、`add_fanmark_favorite` / `remove_fanmark_favorite` RPC を呼び出して即時反映・キャッシュ無効化を行う。
  - 検索成功時には `record_fanmark_search` を呼び出し、`fanmark_discoveries.search_count` を蓄積。
  - 未ログイン時はお気に入りボタン押下でログイン導線 (`onRequireAuth`) を呼び出す。
- ファンマ登録 (`supabase/functions/register-fanmark`)：
  - `fanmarks` への INSERT 後にトリガーで `fanmark_discoveries` / `fanmark_favorites` を自動リンクし、候補状態から取得済みへステータスを更新。
  - バックフィル処理により既存レコードも `fanmark_id` が補完される。

## 翻訳・UI
- `en.json` / `ja.json` にお気に入りページおよびダッシュボード統計カードの文言を追加。
- ステータス表示は既存の `fanmarkDetails` 翻訳キーを流用し、ライセンス状態と整合。

## 確認観点
1. ログインユーザーで `/favorites` にアクセスし、登録済みのお気に入りが期待通り表示されるか。
2. 詳細ページでお気に入りをトグルした際、一覧とダッシュボードの件数が更新されるか。
3. 未ログイン状態で `/favorites` にアクセスすると `/auth` へリダイレクトされるか。
4. RLS により他ユーザーのデータが取得できないこと（Supabase SQL から `auth.uid()` を切り替えて確認）。
5. 新規検索時に `fanmark_discoveries.search_count` が増加し、未取得でも `fanmark_favorites` が登録できること。
