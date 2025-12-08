# ファンマ移管システム仕様書

## 1. 概要

ファンマの所有権を別のユーザーに移管するためのシステム。移管コードベースの安全な移管プロセスを提供する。

### 1.1 基本フロー

```
譲渡側（現所有者）           受取側（新所有者）
      │                           │
      ├─ 移管コード発行 ──────────→│
      │   (免責事項に同意)          │
      │                           │
      │←─────── コード入力・申請 ──┤
      │          (免責事項に同意)   │
      │                           │
      ├─ 申請承認 ────────────────→│
      │                           │
      └─ 所有権移転完了 ──────────→└─ 新規ライセンス開始
           (旧ライセンス終了)           (Tier別初回期間付与)
```

---

## 2. データベース設計

### 2.1 fanmark_transfer_codes テーブル

移管コードの管理テーブル。

| カラム | 型 | 説明 |
|--------|------|------|
| id | uuid | PK |
| license_id | uuid | 対象ライセンスID (FK) |
| fanmark_id | uuid | 対象ファンマID (FK) |
| issuer_user_id | uuid | 発行者ユーザーID |
| transfer_code | text | 移管コード（ユニーク） |
| status | text | 状態（下記参照） |
| expires_at | timestamptz | 有効期限（= license.license_end） |
| disclaimer_agreed_at | timestamptz | 免責事項同意日時 |
| created_at | timestamptz | 発行日時 |
| updated_at | timestamptz | 更新日時 |

**status の値:**
- `active`: 有効（申請待ち）
- `applied`: 申請済み（承認待ち）
- `completed`: 移管完了
- `cancelled`: キャンセル済み（発行者による取消 or 新コード発行による自動取消）
- `expired`: 期限切れ（ライセンス期限到達 or grace移行）

### 2.2 fanmark_transfer_requests テーブル

移管申請の管理テーブル。

| カラム | 型 | 説明 |
|--------|------|------|
| id | uuid | PK |
| transfer_code_id | uuid | 移管コードID (FK) |
| license_id | uuid | 対象ライセンスID |
| fanmark_id | uuid | 対象ファンマID |
| requester_user_id | uuid | 申請者ユーザーID |
| status | text | 状態（下記参照） |
| disclaimer_agreed_at | timestamptz | 免責事項同意日時 |
| applied_at | timestamptz | 申請日時 |
| resolved_at | timestamptz | 解決日時（承認/拒否） |
| created_at | timestamptz | 作成日時 |
| updated_at | timestamptz | 更新日時 |

**status の値:**
- `pending`: 承認待ち
- `approved`: 承認済み（移管完了）
- `rejected`: 拒否済み
- `cancelled`: キャンセル（コード期限切れ等による自動キャンセル）
- `expired`: 期限切れ

### 2.3 RLSポリシー

**fanmark_transfer_codes:**
- 発行者は自分のコードを閲覧・キャンセル可能
- 認証済みユーザーはコード検証（申請用）が可能

**fanmark_transfer_requests:**
- 申請者は自分の申請を閲覧可能
- コード発行者は関連申請を閲覧・承認・拒否可能

---

## 3. ビジネスルール

### 3.1 移管コード発行条件

1. **ライセンス残期間**: 48時間以上のアクティブ期間が残っていること
2. **1ライセンス1コード**: 1つのライセンスに対して有効なコードは1つのみ
3. **再発行時の自動キャンセル**: 新コード発行時、既存の`active`コードは自動的に`cancelled`になる
4. **申請中は再発行不可**: `applied`状態のコードがある場合、新規発行は不可
5. **免責事項への同意**: コード発行時にチェックボックスで同意必須

### 3.2 移管コード有効期限

- **有効期限**: `license.license_end`（ライセンス終了日時）
- **最短有効期間**: 48時間（発行条件による）
- **最長有効期間**: ライセンス残期間
- **Tier C（無期限ライセンス）の場合**: 発行日から30日間

### 3.3 移管処理中の制限

移管コードが`active`または`applied`状態の間:

| 操作 | 可否 | 理由 |
|------|------|------|
| ライセンス返却 | ❌ 不可 | 移管プロセス保護 |
| ライセンス延長 | ❌ 不可 | 移管プロセス保護 |
| 設定変更（access_type等） | ✅ 可能 | 現所有者の権限維持 |
| プロファイル編集 | ✅ 可能 | 現所有者の権限維持 |

### 3.4 移管申請条件

1. **自己移管不可**: 発行者と申請者が同一ユーザーの場合はエラー
2. **ファンマ所持上限確認**: 受取側が上限に達している場合はエラー
3. **免責事項への同意**: 申請時にチェックボックスで同意必須

### 3.5 移管完了時の処理

1. **旧ライセンス終了**
   - `status = 'expired'`
   - `is_returned = true`
   - `license_end = now()`

2. **新ライセンス作成**
   - `user_id = 受取側ユーザーID`
   - `license_start = now()`
   - `license_end = Tier別初回期間に基づく`（下記参照）
   - `is_initial_license = false`
   - `is_transferred = true`（新規カラム追加）

3. **Tier別新規ライセンス期間**

| Tier | 絵文字数 | 新規ライセンス期間 |
|------|----------|-------------------|
| Tier C | 4-5個（非連続） | 無期限（`license_end = NULL`） |
| Tier B | 3個 | 30日 |
| Tier A | 2個 or 2-5個（連続） | 14日 |
| Tier S | 1個 | 7日 |

4. **設定データのコピー**
   - `fanmark_basic_configs` → 新ライセンスIDで複製
   - `fanmark_redirect_configs` → 新ライセンスIDで複製
   - `fanmark_messageboard_configs` → 新ライセンスIDで複製
   - `fanmark_profiles` → 新ライセンスIDで複製
   - `fanmark_password_configs` → **コピーしない**（セキュリティ上）

5. **状態更新**
   - 移管コード: `status = 'completed'`
   - 移管申請: `status = 'approved'`, `resolved_at = now()`

6. **監査ログ記録**
   - `action = 'LICENSE_TRANSFERRED'`
   - `metadata` に旧ライセンスID、新ライセンスID、譲渡側/受取側ユーザーID等を含む

---

## 4. 状態依存関係

### 4.1 ライセンスステータス → 移管ステータス（一方向）

```
ライセンス状態変更          移管コード/申請への影響
─────────────────────────────────────────────────────
active → grace        →    transfer_code.status = 'expired'
                           transfer_request.status = 'cancelled'
                           (cancellation_reason = 'license_expired')
```

### 4.2 移管ステータス → ライセンスステータス（影響なし）

- 移管コードの状態変化はライセンスの`active/grace/expired`遷移に**影響しない**
- 移管コードは特定操作（返却・延長）を**ブロック**するだけ
- ライセンスの状態遷移ロジックは変更不要

---

## 5. 免責事項・利用規約

### 5.1 免責事項テキスト

**移管コード発行時（譲渡側）:**
```
【重要】ファンマ移管に関する注意事項

• 移管の承認後は取り消すことができません
• 金銭その他の対価を伴う取引について、運営者は一切関与せず、責任を負いません
• 移管に関連するユーザー間のトラブル（支払いの不履行、詐欺等）について、運営者は一切の責任を負いません
• 移管完了後、受取側には新規取得と同様のライセンス期間が付与されます

上記内容を理解し、同意します。
```

**移管コード申請時（受取側）:**
```
【重要】ファンマ移管に関する注意事項

• 移管の申請後、承認されるまでキャンセルはできません
• 金銭その他の対価を伴う取引について、運営者は一切関与せず、責任を負いません
• 移管に関連するユーザー間のトラブル（支払いの不履行、詐欺等）について、運営者は一切の責任を負いません
• 移管完了後、Tier別の初回ライセンス期間が付与されます（残期間の引き継ぎはありません）

上記内容を理解し、同意します。
```

### 5.2 移管セクション内の常時表示

```
ℹ️ 移管に関するご注意
ユーザー間の取引や金銭のやりとりについて、運営者は一切関与いたしません。
移管はご自身の責任において行ってください。
```

### 5.3 利用規約への追記

**セクション3「ファンマーク所有権と権利」への追加:**

```
• ファンマークの移管：承認された移管機能を通じて、他のユーザーにファンマークを移管することができます
• 移管時のライセンス：移管完了時、受取側にはファンマークのティアに応じた新規ライセンス期間が付与されます（残期間の引き継ぎはありません）
• 移管の最終性：承認された移管は取り消すことができません
• ユーザー間取引の免責：運営者は、ファンマーク移管に関連するユーザー間の金銭取引その他の合意について、一切関与せず、責任を負いません。これには、支払いの不履行、詐欺、その他のトラブルが含まれますが、これらに限定されません
• 自己責任：ファンマークの移管は、すべてご自身の責任において行ってください
```

---

## 6. Edge Functions 設計

### 6.1 generate-transfer-code（新規）

移管コード発行用。

**入力:**
```json
{
  "fanmark_id": "uuid",
  "license_id": "uuid",
  "disclaimer_agreed": true
}
```

**処理:**
1. 認証確認
2. `disclaimer_agreed = true` 確認
3. ライセンス所有権確認
4. ライセンス残期間確認（48時間以上）
5. 既存activeコード確認 → あれば自動キャンセル
6. applied状態コード確認 → あればエラー
7. 新コード生成・保存（`disclaimer_agreed_at = now()`）
8. 監査ログ記録

**出力:**
```json
{
  "success": true,
  "transfer_code": "XXXX-XXXX-XXXX",
  "expires_at": "2025-12-15T00:00:00Z"
}
```

### 6.2 apply-transfer-code（新規）

移管コード申請用。

**入力:**
```json
{
  "transfer_code": "XXXX-XXXX-XXXX",
  "disclaimer_agreed": true
}
```

**処理:**
1. 認証確認
2. `disclaimer_agreed = true` 確認
3. コード存在・有効性確認
4. 自己移管チェック（発行者≠申請者）
5. ファンマ所持上限チェック
6. 申請レコード作成（`disclaimer_agreed_at = now()`）
7. コード状態を`applied`に更新
8. 通知イベント発行（発行者向け）

### 6.3 approve-transfer-request（新規）

移管承認用。

**入力:**
```json
{
  "request_id": "uuid"
}
```

**処理:**
1. 認証確認
2. 申請存在・pending状態確認
3. ライセンスactive確認（grace移行していないか）
4. 移管処理実行:
   - 旧ライセンス終了
   - 新ライセンス作成（Tier別期間）
   - 設定データコピー
5. 各種状態更新
6. 通知イベント発行（受取側向け）
7. 監査ログ記録

### 6.4 reject-transfer-request（新規）

移管拒否用。

**入力:**
```json
{
  "request_id": "uuid"
}
```

**処理:**
1. 認証確認
2. 申請存在・pending状態確認
3. 申請状態を`rejected`に更新
4. コード状態を`active`に戻す（再利用可能に）
5. 通知イベント発行（受取側向け）

### 6.5 cancel-transfer-code（新規）

移管コードキャンセル用。

**入力:**
```json
{
  "transfer_code_id": "uuid"
}
```

**処理:**
1. 認証確認
2. コード存在・active状態確認（applied状態は不可）
3. コード状態を`cancelled`に更新

### 6.6 check-expired-licenses（既存拡張）

期限切れチェックに移管コード自動期限切れ処理を追加。

**追加処理:**
1. license_end到達のactiveコード → `expired`に更新
2. 関連するpending申請 → `cancelled`に更新（`cancellation_reason = 'license_expired'`）

### 6.7 return-fanmark（既存拡張）

**追加処理:**
1. 移管コード存在チェック（active/applied）
2. 存在する場合 → エラー返却: `transfer_in_progress`

### 6.8 extend-fanmark-license（既存拡張）

**追加処理:**
1. 移管コード存在チェック（active/applied）
2. 存在する場合 → エラー返却: `transfer_in_progress`

---

## 7. 通知システム

### 7.1 通知イベント一覧

| イベント | トリガー | 送信先 | 内容 |
|----------|----------|--------|------|
| transfer_requested | 受取側が申請 | 発行者 | 「〇〇さんから移管申請がありました」 |
| transfer_approved | 発行者が承認 | 受取側 | 「移管が完了しました」 |
| transfer_rejected | 発行者が拒否 | 受取側 | 「移管申請が拒否されました」 |
| transfer_expired | コード期限切れ | 発行者・受取側 | 「移管コードの期限が切れました」 |

### 7.2 監査ログ

| アクション | 記録タイミング |
|------------|----------------|
| TRANSFER_CODE_ISSUED | コード発行時 |
| TRANSFER_CODE_CANCELLED | コードキャンセル時 |
| TRANSFER_REQUESTED | 移管申請時 |
| TRANSFER_APPROVED | 移管承認時 |
| TRANSFER_REJECTED | 移管拒否時 |
| LICENSE_TRANSFERRED | 移管完了時（メイン監査ログ） |

---

## 8. UI/UX 設計

### 8.1 ダッシュボード構成変更

**変更前:**
```
ダッシュボード
├── あなたのファンマ（タブ）
├── ファンマ検索（タブ）
└── お気に入り（タブ）
```

**変更後:**
```
ダッシュボード
├── ファンマ管理（タブ）← 名称変更
│   ├── あなたのファンマ（セクション）
│   │   └── [ファンマ一覧テーブル]
│   │       └── 各行に [移管中] / [承認待ち] バッジ
│   └── ファンマの移管（セクション）← 新規追加・常時表示
│       ├── [注意事項テキスト]
│       ├── [移管コード入力ボタン]
│       ├── [発行中のコード一覧]
│       └── [申請中/承認待ち一覧]
├── ファンマ検索（タブ）
└── お気に入り（タブ）
```

### 8.2 ファンマ行のバッジ表示

**通常状態:**
```
🎮🎯 GameMaster    有効期限: 2025/12/15    [設定]
```

**移管コード発行中（active）:**
```
🎮🎯 GameMaster    有効期限: 2025/12/15    [移管中]    [設定]
```

**移管申請承認待ち（applied）:**
```
🎮🎯 GameMaster    有効期限: 2025/12/15    [承認待ち]    [設定]
```

### 8.3 移管セクション内の表示

**常時表示の注意事項:**
```
ℹ️ 移管に関するご注意
ユーザー間の取引や金銭のやりとりについて、運営者は一切関与いたしません。
移管はご自身の責任において行ってください。
```

**移管コード入力ボタン:**
```
[移管コードを入力]
```

**発行中のコード一覧（譲渡側）:**
```
発行中の移管コード
─────────────────────────────────────
🎮🎯 GameMaster
コード: XXXX-XXXX-XXXX  [コピー]
有効期限: 2025/12/15 23:59
状態: 申請待ち
[キャンセル]
```

**承認待ちの申請一覧（譲渡側）:**
```
承認待ちの移管申請
─────────────────────────────────────
🎮🎯 GameMaster → @new_user さんへ
申請日時: 2025/12/08 14:30
[承認する] [拒否する]
```

**申請中一覧（受取側）:**
```
あなたの移管申請
─────────────────────────────────────
🎮🎯 GameMaster ← @current_owner さんから
申請日時: 2025/12/08 14:30
状態: 承認待ち
```

### 8.4 移管コード発行ダイアログ

```
┌─────────────────────────────────────────┐
│  移管コードの発行                        │
├─────────────────────────────────────────┤
│                                         │
│  🎮🎯 GameMaster                        │
│                                         │
│  ⚠️ 重要な注意事項                      │
│  ────────────────────────────           │
│  • 移管の承認後は取り消すことが          │
│    できません                            │
│  • 金銭その他の対価を伴う取引に          │
│    ついて、運営者は一切関与せず、        │
│    責任を負いません                      │
│  • 移管に関連するユーザー間のトラ        │
│    ブルについて、運営者は一切の          │
│    責任を負いません                      │
│  • 移管完了後、受取側には新規取得        │
│    と同様のライセンス期間が付与          │
│    されます                              │
│                                         │
│  ☑ 上記内容を理解し、同意します          │
│                                         │
│  [キャンセル]        [コードを発行]      │
└─────────────────────────────────────────┘
```

### 8.5 移管コード申請ダイアログ

```
┌─────────────────────────────────────────┐
│  移管コードの入力                        │
├─────────────────────────────────────────┤
│                                         │
│  移管コード                              │
│  ┌─────────────────────────────┐        │
│  │ XXXX-XXXX-XXXX              │        │
│  └─────────────────────────────┘        │
│                                         │
│  ⚠️ 重要な注意事項                      │
│  ────────────────────────────           │
│  • 申請後、承認されるまでキャンセル      │
│    はできません                          │
│  • 金銭その他の対価を伴う取引に          │
│    ついて、運営者は一切関与せず、        │
│    責任を負いません                      │
│  • 移管に関連するユーザー間のトラ        │
│    ブルについて、運営者は一切の          │
│    責任を負いません                      │
│  • 移管完了後、Tier別の初回ライ          │
│    センス期間が付与されます              │
│                                         │
│  ☑ 上記内容を理解し、同意します          │
│                                         │
│  [キャンセル]          [申請する]        │
└─────────────────────────────────────────┘
```

### 8.6 エラーメッセージ

| 状況 | メッセージ |
|------|------------|
| 48時間未満 | 「ライセンス残期間が48時間未満のため、移管コードを発行できません」 |
| 申請中に再発行 | 「承認待ちの申請があるため、新しいコードを発行できません」 |
| 返却ブロック | 「移管処理中のため、返却できません。移管をキャンセルしてください」 |
| 延長ブロック | 「移管処理中のため、延長できません。移管をキャンセルしてください」 |
| 自己移管 | 「自分自身への移管はできません」 |
| 上限超過（受取側） | 「ファンマ所持数が上限に達しているため、移管を受けられません」 |
| 免責未同意 | 「注意事項への同意が必要です」 |
| コード無効 | 「移管コードが無効または期限切れです」 |

---

## 9. 実装チェックリスト

### Phase 1: データベース
- [ ] fanmark_transfer_codes テーブル作成
- [ ] fanmark_transfer_requests テーブル作成
- [ ] fanmark_licenses に `is_transferred` カラム追加
- [ ] RLSポリシー設定
- [ ] インデックス作成

### Phase 2: Edge Functions
- [ ] generate-transfer-code 実装
- [ ] apply-transfer-code 実装
- [ ] approve-transfer-request 実装
- [ ] reject-transfer-request 実装
- [ ] cancel-transfer-code 実装
- [ ] check-expired-licenses 拡張
- [ ] return-fanmark 拡張（ブロック処理）
- [ ] extend-fanmark-license 拡張（ブロック処理）

### Phase 3: 通知システム
- [ ] notification_templates 追加（4種類）
- [ ] notification_rules 追加

### Phase 4: 利用規約更新
- [ ] ja.json に移管条項追加
- [ ] en.json に移管条項追加

### Phase 5: フロントエンド
- [ ] ダッシュボードタブ名変更（あなたのファンマ → ファンマ管理）
- [ ] 移管セクションUI実装
- [ ] ファンマ行への [移管中] / [承認待ち] バッジ追加
- [ ] 移管コード発行ダイアログ（免責チェックボックス付き）
- [ ] 移管コード入力ダイアログ（免責チェックボックス付き）
- [ ] 承認/拒否ダイアログ
- [ ] 翻訳テキスト追加

### Phase 6: テスト・統合
- [ ] 単体テスト
- [ ] 統合テスト
- [ ] エッジケーステスト（grace移行時等）

---

## 10. 関連ファイル

### 新規作成予定
- `supabase/functions/generate-transfer-code/index.ts`
- `supabase/functions/apply-transfer-code/index.ts`
- `supabase/functions/approve-transfer-request/index.ts`
- `supabase/functions/reject-transfer-request/index.ts`
- `supabase/functions/cancel-transfer-code/index.ts`
- `src/components/FanmarkTransferSection.tsx`
- `src/components/TransferCodeIssueDialog.tsx`
- `src/components/TransferCodeInputDialog.tsx`
- `src/components/TransferApprovalDialog.tsx`
- `src/hooks/useTransferCode.tsx`
- `src/hooks/useTransferRequest.tsx`

### 既存更新予定
- `supabase/functions/check-expired-licenses/index.ts`
- `supabase/functions/return-fanmark/index.ts`
- `supabase/functions/extend-fanmark-license/index.ts`
- `src/pages/Dashboard.tsx`
- `src/components/FanmarkDashboard.tsx`
- `src/translations/ja.json`（移管関連テキスト + 利用規約）
- `src/translations/en.json`（移管関連テキスト + 利用規約）
