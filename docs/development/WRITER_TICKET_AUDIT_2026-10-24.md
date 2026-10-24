# #71の個別writer票の読取り監査

従来の`/inspect`は件数と種類・版の周辺集計だけで、個別票を手元の実行記録と照合できなかった。18:53 JSTの24票は11:05 JSTと同じ集計だったが、同じ票集合や処理終了の証明ではない。

## 読取り専用の追加

既存DOのbinding内に`POST /audit`を追加する。入力はUUIDと現行scopeだけ。scope・fence・counterと完全走査が一致する1,000票以下のsnapshotに限り、個別ID・開始時刻・種類・runtime revision・旧形式の有無を返す。旧boolean票の時刻・版はnullのままで推測しない。破損・不一致・上限超過は拒否する。

`transactionSync`の中で一度だけsnapshotを読み、scope/active/ticket/fenceを保存・削除しない。通常inspectの集計と公開HTTP APIは同じ契約を保つ。新binding・namespace・schema・秘密値をアプリへ追加せず、frontendとPWAも変更しない。通常要求で個別監査を呼ばない。

個別票の結果は、明示した期限・認証・完全一致GET経路だけを持つ短命のoperatorからGit外0700/0600領域へ取得する。個別IDを公開log・Issue・Gitへ書かない。operatorは監査だけを行い、票を終了させる入口を持たない。終了後にoperatorと経路を削除して元のinventoryを照合する。

## 検査と終了判定

追加前のnative試験は未実装の404で失敗。追加後は未初期化、旧票、帰属付き票、fence中、上限1,000票と超過、不正scope/key/metadata、counter不一致を検査し、全保存keyが不変であることを照合する。実行中callbackは監査後もactiveに残り、そのcallbackが終了してleaveした後だけdrainedになる。

監査の追加だけで既存24票を終了済みと認定しない。個別票と同じ呼出しの業務未開始または全業務終了を裏付ける原本を探す。時刻・runtime・件数の一致だけでは足りない。証拠不足なら票を保持し、自然日次backupを成功と認定しない。既存slot・手動capture・通知を再送せず、fence強制解除や台帳初期化を行わない。外部サポートへは送信しない。

配備・個別照合・自然backupの実際の結果は#71とGit外journalへ日時付きで記録する。今回の操作原本は`~/.codex/private/fanmark-writer-ticket-audit-2026-10-24-1413/`。
