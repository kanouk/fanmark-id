# 主要画面の変更入口

表示を変える場合はview、取得・保存・課金などを変える場合はcontrollerから読む。
controllerの戻り値の型は実装から推論し、APIのDTOは既存client層で検証する。

| 対象 | view | 状態・操作 | 補助 |
| --- | --- | --- | --- |
| ダッシュボード | components/FanmarkDashboard.tsx | components/dashboard/useDashboardController.tsx | dashboard/presentation.tsxがバッジ・表示スタイル |
| ファンマ設定 | components/FanmarkSettings.tsx | components/fanmark-settings/useFanmarkSettingsController.tsx | fanmark-settings/model.tsがフォーム型・検証 |
| アカウント | pages/Profile.tsx | pages/profile/useProfileController.tsx | UserProfileForm、課金API、退会API |
| 検索・取得 | components/FanmarkAcquisition.tsx | components/acquisition/useAcquisitionController.tsx | 検索・抽選は既存hook |
| 絵文字入力 | components/EmojiInput.tsx | components/emoji-input/useEmojiInputController.tsx | emoji-input/model.tsがpropsと最大入力数 |

表のpathはsrc/からの相対path。画面名の対応はARCHITECTUREも参照する。
対象の操作とフォームの保持条件を確認してから変更する。

## サーバー情報の共有と更新

- useProfile、useOwnedFanmarks、useFavoriteFanmarksはReact Queryを使う。
  owner-query.tsのキーに本人IDと情報の種類を入れる。別ユーザーの以前のデータをplaceholderへ渡さない。
- 認証確認で取得する本人プロフィールも同じqueryへ接続し、複数の表示箇所で共有する。
  ユーザーが変わった時とログアウト成功時にcacheを消去する。遅い旧session/profile応答は世代番号で無効化する。
- プロフィール保存の検証済み応答は共有cacheへ反映する。取得後は所有一覧・お気に入り、
  ファンマ設定保存後は所有一覧を無効化し再取得する。返却・延長・移管も既存の再取得から同じcacheを更新する。
- 決済から戻っただけでは成功にしない。既存の署名された適用結果と上限付きpollingを保持する。
- 入力・下書き・編集中のパスワードはフォーム側に残す。保存失敗時に消さず、保存成功時だけ下書きを消す。

## 回帰確認

`verify:app`で型・Lint・client・認証競合とcache契約を確認する。
`test:local`は実Worker、DBへの保存、検索・取得、PC/390px、本人プロフィール共有、アカウント切替を確認する。
`test:staging-profile-editor-local`は実Worker/R2で失敗保存・下書き復元・画像・他人拒否、
`test:staging-profile-editor-ui`は隔離した応答でcold start・拒否・通信失敗・再試行を確認する。
通常CIにこれらを含める。外部providerを使う成功試験の代用とはしない。
