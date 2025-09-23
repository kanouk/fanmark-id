# fanmark.id 要件定義書

## 1. ドキュメント情報
- 作成日: 2024-XX-XX（要更新）
- 作成者: AIアシスタント（ChatGPT）
- 対象リポジトリ: fanmark-id

## 2. 背景・目的
- fanmark.id は、絵文字の組み合わせ（ファンマ）を用いた新世代のID/リンク体験を提供し、利用者が覚えやすく共有しやすいアドレスを手に入れられることを目的とする。【F:src/translations/ja.json†L2-L53】
- サービスはクリエイターや店舗など多様な利用者が自分らしいファンマを取得し、プロフィールやリンク集として活用できるよう支援する。【F:src/translations/ja.json†L138-L175】【F:src/translations/ja.json†L238-L333】

## 3. サービス概要
- 利用者は1〜5個の絵文字からなるファンマを検索し、空き状況や価格を確認したうえで取得できる。【F:src/hooks/useFanmarkSearch.tsx†L160-L206】【F:src/translations/ja.json†L11-L45】
- 取得したファンマはダッシュボードから一覧管理し、アクセスタイプ（プロフィール／リダイレクト／テキスト／未設定）や表示名などを編集できる。【F:src/components/FanmarkDashboard.tsx†L132-L198】【F:src/components/FanmarkSettings.tsx†L127-L200】
- 公開側では、設定されたアクセスタイプに応じてプロフィールページ表示や外部URLへのリダイレクト、メッセージ表示などの体験を提供する。【F:src/components/FanmarkAccess.tsx†L20-L155】【F:src/components/FanmarkProfile.tsx†L41-L156】【F:src/components/FanmarkMessage.tsx†L23-L104】

## 4. 用語定義
| 用語 | 定義 | 出典 |
| --- | --- | --- |
| ファンマ (Fanmark) | 絵文字の組み合わせを主キーとするIDレコード。アクセスタイプ、短縮ID、ステータス、所有ユーザーなどを保持する。【F:src/integrations/supabase/types.ts†L254-L315】 |
| ファンマライセンス | ファンマの利用権を期間管理するライセンス。開始日・終了日・ステータス・ティア情報を持ち、ファンマと利用者を紐付ける。【F:src/integrations/supabase/types.ts†L150-L213】 |
| ファンマティア | 絵文字数に応じたティア設定で、取得期間や価格を管理するメタデータ。【F:src/integrations/supabase/types.ts†L215-L252】 |
| アクセスタイプ | ファンマアクセス時の挙動（プロフィール、リダイレクト、テキスト、未設定）。【F:src/components/FanmarkSettings.tsx†L38-L56】【F:src/components/FanmarkAccess.tsx†L11-L139】 |
| 招待コード | サービス参加を制御するコード。使用回数・特典などを管理するテーブルを持つ。【F:src/integrations/supabase/types.ts†L316-L353】 |
| システム設定 | 招待モードや最大ファンマ数などの全体設定を格納するキー・バリュー形式のデータ。【F:src/integrations/supabase/types.ts†L469-L498】【F:src/hooks/useSystemSettings.tsx†L11-L56】 |

## 5. ステークホルダー
- クリエイター／店舗／配信者など、自身のブランドを象徴する絵文字リンクを求める利用者。【F:src/translations/ja.json†L138-L175】
- サービス運営チーム（招待制管理、システム設定、監査ログ活用）。【F:src/integrations/supabase/types.ts†L10-L49】【F:src/hooks/useInvitationCode.tsx†L17-L110】
- 公開閲覧者（取得済みファンマにアクセスし、プロフィールやメッセージを閲覧するユーザー）。【F:src/components/FanmarkAccess.tsx†L20-L155】

## 6. スコープ
- **インスコープ**: 認証／招待制登録、ファンマ検索・取得、ダッシュボード管理、ファンマ設定編集、プロフィール管理、多言語UI、公開アクセス体験、通知トースト、システム設定参照。【F:src/pages/Auth.tsx†L18-L200】【F:src/components/FanmarkAcquisition.tsx†L45-L200】【F:src/components/FanmarkDashboard.tsx†L64-L333】【F:src/components/FanmarkSettings.tsx†L81-L200】【F:src/hooks/useProfile.tsx†L25-L124】【F:src/components/Navigation.tsx†L37-L118】【F:src/hooks/useSystemSettings.tsx†L11-L56】
- **アウトオブスコープ**: 決済処理実装、AIレコメンド本格提供（近日対応の記載のみ）。【F:src/translations/ja.json†L191-L195】

## 7. ユースケース
1. **ファンマ検索と取得**: 利用者が絵文字を入力すると正規化・バリデーションが行われ、空き状況や取得可否が提示される。取得上限に達していなければ登録ダイアログから確定できる。【F:src/hooks/useFanmarkSearch.tsx†L160-L284】【F:src/components/FanmarkAcquisition.tsx†L49-L154】
2. **ダッシュボードでの管理**: 利用者は保有ファンマを一覧で確認し、返却、設定画面遷移、コピーなどの操作を行える。【F:src/components/FanmarkDashboard.tsx†L64-L333】
3. **ファンマ設定変更**: 表示名・アクセスタイプ・リンク先・テキストを編集し、必要に応じてプロフィールページを自動生成できる。【F:src/components/FanmarkSettings.tsx†L127-L177】
4. **招待コード検証／待機リスト登録**: 新規参加者は招待コードの有効性を確認し、使用または待機リスト登録ができる。【F:src/hooks/useInvitationCode.tsx†L17-L110】
5. **公開アクセス**: 一般ユーザーがファンマURLにアクセスすると、設定に応じたプロフィールやメッセージが表示され、リダイレクトが必要な場合は即時遷移する。【F:src/components/FanmarkAccess.tsx†L28-L155】

## 8. 機能要件
### 8.1 認証・アカウント管理
- Supabase認証とメール確認を用いたログイン／新規登録／確認メール再送／パスワードリセットを提供する。ログイン状態ではダッシュボードへ自動遷移する。【F:src/pages/Auth.tsx†L18-L200】
- パスワード入力は要件表示とバリデーションで強度を確認する。【F:src/pages/Auth.tsx†L155-L198】

### 8.2 招待制・待機リスト
- 招待コードはRPC `validate_invitation_code`/`use_invitation_code` を通じて検証・消費され、残り使用回数と特典を返却する。【F:src/hooks/useInvitationCode.tsx†L17-L79】
- 招待がなくてもメールを待機リストに登録でき、重複登録はエラー扱いせず成功として扱う。【F:src/hooks/useInvitationCode.tsx†L81-L103】

### 8.3 ファンマ検索・取得
- 絵文字入力は1〜5個の絵文字に制限され、肌色バリエーションは正規化されて検索される。【F:src/hooks/useFanmarkSearch.tsx†L160-L206】【F:src/translations/ja.json†L46-L53】
- 取得処理はSupabase Edge Function `register-fanmark` を呼び出し、成功時は設定ページへ遷移しトーストで通知する。【F:src/components/FanmarkAcquisition.tsx†L88-L121】
- 取得上限（デフォルト10件）を超えた場合は警告トーストが表示される。【F:src/components/FanmarkAcquisition.tsx†L49-L83】【F:src/components/FanmarkDashboard.tsx†L64-L166】

### 8.4 ダッシュボード
- ファンマ一覧をSupabaseから取得し、ライセンス情報とともに表示する。タブで「マイファンマ」「ファンマを探す」を切り替えられる。【F:src/components/FanmarkDashboard.tsx†L132-L333】
- ファンマ返却は `return-fanmark` Edge Function を呼び出し、成功・失敗に応じてトーストを表示する。【F:src/components/FanmarkDashboard.tsx†L72-L105】

### 8.5 ファンマ設定
- アクセスタイプごとの必須項目（リダイレクトURL、テキストなど）をフォームでバリデーションし、更新内容をSupabaseへ保存する。【F:src/components/FanmarkSettings.tsx†L38-L177】
- プロフィール型を選択した場合、必要に応じて `emoji_profiles` に初期プロフィールを作成する。【F:src/components/FanmarkSettings.tsx†L146-L161】

### 8.6 公開アクセス
- URLパラメータから絵文字を復元し、RPC `get_fanmark_by_emoji` で必要最小限のデータを取得してアクセス処理を分岐する。【F:src/components/FanmarkAccess.tsx†L28-L139】
- プロフィール表示時は公開プロフィール情報を読み込み、ソーシャルリンクやバイオを表示する。【F:src/components/FanmarkProfile.tsx†L41-L144】
- テキスト表示タイプではメッセージを表示し、コピー操作を提供する。【F:src/components/FanmarkMessage.tsx†L23-L104】

### 8.7 プロフィール管理
- ログインユーザーのプロフィールを取得・更新し、リアルタイムチャネルで変更を購読する。【F:src/hooks/useProfile.tsx†L25-L124】
- プロフィール編集画面は表示名・自己紹介・アバター・公開設定などを扱う文言が翻訳ファイルで定義されている。【F:src/translations/ja.json†L200-L237】

### 8.8 多言語対応
- ヘッダーや認証画面に言語切替トグルを配置し、翻訳キーを用いて日英切替を実現する。【F:src/components/Navigation.tsx†L37-L118】【F:src/pages/Auth.tsx†L109-L200】

### 8.9 通知・トースト
- 主要操作（取得成功／失敗、返却成功／失敗など）はトースト通知でフィードバックする。【F:src/components/FanmarkAcquisition.tsx†L92-L117】【F:src/components/FanmarkDashboard.tsx†L88-L101】

## 9. 非機能要件
- **可用性**: Supabaseの認証・データベース・ストレージを利用し、エラー時にはログ出力とトーストで利用者に通知する実装が存在する。【F:src/components/FanmarkAcquisition.tsx†L110-L117】【F:src/components/FanmarkDashboard.tsx†L93-L164】【F:src/hooks/useProfile.tsx†L59-L116】
- **セキュリティ**: 所有者情報は検索時に匿名化され、招待コードやRPCを通じた検証でアクセス制御を行う。【F:src/hooks/useFanmarkSearch.tsx†L258-L284】【F:src/hooks/useInvitationCode.tsx†L17-L79】
- **性能**: 検索結果や最近取得したファンマは件数を制限して取得し、ローカルストレージに検索プリフィルを保存して再検索を最適化する。【F:src/hooks/useFanmarkSearch.tsx†L92-L135】【F:src/components/FanmarkDashboard.tsx†L107-L130】
- **監査性**: `audit_logs` テーブルにより操作履歴を保存できる設計になっている。【F:src/integrations/supabase/types.ts†L16-L49】
- **国際化**: hero・ダッシュボード・プロフィールなどの全主要文言が翻訳ファイルで管理されている。【F:src/translations/ja.json†L2-L381】

## 10. データ要件
- **主要テーブル**:
  - `fanmarks`: 絵文字組み合わせ、短縮ID、アクセスタイプ、ステータス、所有者IDなどを保持する。【F:src/integrations/supabase/types.ts†L254-L315】
  - `fanmark_licenses`: 利用期間とステータス、ティアを管理し、`fanmarks` と `fanmark_tiers` に外部キー連携する。【F:src/integrations/supabase/types.ts†L150-L213】
  - `fanmark_tiers`: 絵文字数区分と初期ライセンス日数、価格を定義する。【F:src/integrations/supabase/types.ts†L215-L252】
  - `emoji_profiles`: ファンマに紐づく公開プロフィールのバイオ、ソーシャルリンク、公開設定を保持する。【F:src/integrations/supabase/types.ts†L17-L107】
  - `profiles`: 利用者プロフィール（表示名、アバター、公開設定、招待特典など）を管理する。【F:src/integrations/supabase/types.ts†L355-L410】
  - `invitation_codes`: 招待コードの状態・使用回数・特典を記録する。【F:src/integrations/supabase/types.ts†L316-L353】
  - `system_settings`: 公開設定のみ取得し、招待モードや最大ファンマ数を提供する。【F:src/integrations/supabase/types.ts†L469-L498】
  - `waitlist`: 招待待機者のメールとステータスを保持する。【F:src/integrations/supabase/types.ts†L499-L520】
- **ビュー／RPC**: `fanmark_search_*` ビューや `get_fanmark_by_emoji`、`get_fanmark_ownership_status` などのRPCを利用して検索・公開データ取得・所有状態確認を行う。【F:src/hooks/useFanmarkSearch.tsx†L212-L284】【F:src/components/FanmarkAccess.tsx†L28-L67】

## 11. 外部連携・API
- Supabase Edge Functions `register-fanmark` と `return-fanmark` を用いてファンマ登録・返却ロジックをサーバー側で実行し、RPCを通じて招待コード検証やファンマ取得を行う。【F:src/components/FanmarkAcquisition.tsx†L92-L121】【F:src/components/FanmarkDashboard.tsx†L76-L105】【F:src/hooks/useInvitationCode.tsx†L17-L79】【F:supabase/functions/register-fanmark/index.ts†L86-L200】
- Supabase Storageはアバター画像のアップロード／削除に利用される（アップロード専用フックで処理）。【F:src/hooks/useAvatarUpload.tsx†L11-L109】

## 12. 画面・UX要件
- **ランディングページ**: ヒーローセクション、検索セクション、事例、ステップ解説、CTAを含む多彩なUIを提供する。【F:src/pages/Index.tsx†L24-L210】
- **グローバルナビ**: ロゴ、言語切替、ユーザーメニュー／ログイン導線を提供する。【F:src/components/Navigation.tsx†L37-L118】
- **認証画面**: ログイン・新規登録タブ、パスワード要件表示、メール確認待ち画面を提供する。【F:src/pages/Auth.tsx†L47-L200】
- **ダッシュボード**: 統計カード、ファンマ一覧テーブル、モーダルでの取得導線などレスポンシブUIを備える。【F:src/components/FanmarkDashboard.tsx†L172-L333】
- **ファンマ設定ページ**: 画面全体を使った設定フォームと成功トーストを提供する。【F:src/pages/FanmarkSettingsPage.tsx†L20-L109】
- **公開閲覧画面**: アクセスタイプに応じた個別のUIを提供し、未設定時の案内も行う。【F:src/components/FanmarkAccess.tsx†L20-L155】

## 13. 制約・前提
- 絵文字入力は1〜5個まで、有効な絵文字のみ許可する。【F:src/hooks/useFanmarkSearch.tsx†L160-L206】
- 利用者が保有できるファンマ数はデフォルト10件であり、システム設定値により変更可能である。【F:src/components/FanmarkDashboard.tsx†L64-L166】【F:src/hooks/useSystemSettings.tsx†L11-L56】
- サービスは招待制を前提としており、招待コードまたは待機リスト参加が必要である。【F:src/translations/ja.json†L55-L74】【F:src/hooks/useInvitationCode.tsx†L17-L103】
- 公開アクセス時のリダイレクトやプロフィール情報はRPC経由で取得し、敏感情報をクライアントに渡さない。【F:src/components/FanmarkAccess.tsx†L28-L70】【F:src/hooks/useFanmarkSearch.tsx†L258-L284】

## 14. 将来拡張候補
- AIによるファンマ推薦や価値評価などの機能が翻訳文言により予告されており、将来的な実装が想定される。【F:src/translations/ja.json†L191-L195】【F:src/translations/ja.json†L297-L305】
- プレミアム絵文字や短いファンマの有料化ルールが示唆されており、決済連携・課金管理が今後の検討対象である。【F:src/translations/ja.json†L36-L45】【F:supabase/functions/register-fanmark/index.ts†L147-L200】

## 15. リスクと対応方針
- Supabaseエッジ関数やRPCが失敗した場合のエラーハンドリングを強化し、ユーザーへの再試行導線を明確化する必要がある（現状はトーストで通知しつつ、追加対策が求められる）。【F:src/components/FanmarkAcquisition.tsx†L110-L117】【F:src/components/FanmarkDashboard.tsx†L93-L164】
- プロフィールやファンマ設定の保存失敗時には詳細ログを確認し、監査テーブルとの連携で問題追跡を行う。【F:src/components/FanmarkSettings.tsx†L170-L177】【F:src/integrations/supabase/types.ts†L16-L49】
