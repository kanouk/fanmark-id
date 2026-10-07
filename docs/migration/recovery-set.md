# 全ストアをまとめる保存・復旧処理

`workers/api/src/recovery-set.ts`はAuth/Business/Master D1とavatars/cover-images R2を
`fanmark-recovery-set-v1`としてまとめる管理用coordinator。
`recovery-set-files.mjs`はhost側のprivate file保存/読込。router、Cron、運用鍵保管、
off-host transport、retentionを自動で設定する処理ではない。

## 保存点と鍵

- 呼出元は独立に信頼した3 schema hash、5 source identity、archive key ID、runtime revision、
  元のBetter Auth SDK secretを指定する。schema pinをarchiveから取得して自己承認しない。
- sourceの停止/drainを所有するtrusted adapterの`assertHeld(expectedIds)`が必須。
  guard IDと実際のlive objectを保持し、開始/各store/再取得/終了で確認する。booleanだけは
 受け付けない。再取得で全snapshot hashが異なる場合も完成archiveを返さない。
- guard callbackが存在するだけで実環境の停止を証明しない。adapterは実binding、runtime、
  writer停止/drainとleaseを照合する責任を持つ。local fixtureはAPI/jobなしのowned環境。
  **現行CUTOVER_WRITE_FREEZEはsignin/signout/TOTP/Stripe receiptを許可するため、
  このguardの採用済み実装とは扱わない。** writerが止まる実環境の方式は未採用。
- 5 componentは既存のAuth/Business/Master/R2 formatで個別にAES-256-GCM暗号化する。
  全componentのcipher hash/snapshot hashとsource/schema/key/runtime/guard情報を、小さい
  encrypted manifestへ結び付ける。同じkindの別archiveを混ぜても読込を拒否する。
- archive鍵とSDK secretのraw値は保存しない。元SDK secretがないとfactor等を戻せない。
  archive鍵の交換・過去keyとの対応・off-host保管は呼出元の運用方針に従う。
- Businessの現在プロフィールuser_idがAuth userに存在することも確認する。このチェックは
  任意の履歴・外部provider・全cross-store関係の包括的な照合ではない。

## private file

`saveRecoverySetFile(path, archive, context, key)`は全componentを検証してから、repo外の
本人所有0700 directoryへ0600一時fileを書きfsync、exclusive linkで完成fileを作る。
既存fileは置き換えない。commit後の不明な応答でも完成fileを削除せず、同じpathを確認する。
`readRecoverySetFile()`はsymlink拒否/owner/mode/size・読込中size一致を確認し、全体を検証する。

各partのJSONは128 MiB、合計part/fileは256 MiB、manifest暗号文は64 KiB上限。
leafごとの32 MiB等の上限も維持する。host側の上限であり、Worker128 MiB memoryや
本番最大容量のCPU/所要時間を受け入れた値ではない。JS string/objectの完全なmemory消去は
保証せず、crypto/file byte buffersの消去とprivate永続保存を分ける。

## 復旧と再開

`restoreRecoverySet()`は同じcontext/keyに加え、5 target identity、target隔離/drain guard、
明示mode/session policy、永続checkpoint用`progress` callbackを要求する。
source identityをtargetとして指定することと、重複target identityを拒否する。

1. manifestと全5 componentを認証/復号し、schema/SDK鍵/全hashを検証する。
2. 最初のwrite前に全targetを読み、`new-empty`なら空だけ、`resume-exact`ならD1全体の
   exact一致/R2全objectのexact subsetだけを許す。未知keyや異なるmetadataは全write前に拒否。
3. Master→Business→Auth→avatars→coversの順に、guardとcheckpointのstarted/verifiedを確認する。
   別D1/R2のcommitは単一transactionではない。失敗時は保存済みtargetを削除/巻き戻さない。
4. D1のcommit後ACK喪失では、再開時に全capture/hashを照合し、一致したD1を再INSERTしない。
   R2は不足分だけを条件付き作成する。checkpoint表示だけを完了判定に使わない。
5. 最後に全targetを取得し、選択したsession policyによるdesired hashが全て一致してから完了。
   結果にはcapture ID、適用したsession policyと復旧後のhashを残す。

`isolated-preserve`はisolatedFidelity=trueの試験だけ。
`revoke-local-sessions-and-challenges`はsession/mfaAssurance/verificationを戻さず、credential/
factor/role等を保持する。元archiveのAuth hashと失効後targetのhashは別で記録する。
全targetの照合が終わるまではアプリ/Cron/DO/provider dispatcherを閉じておく。

## 検証と残件

```sh
npm --prefix workers/api run test:recovery-set
```

native local D1（Business現行27、Auth4、Master8+historical Auth）/R2とprivate fileで6件。
guard拒否/live lease失効/観測したsource変化、別part混入/SDK鍵違い/既存file非上書き、
foreign R2による全D1無書込拒否、実Business commit後ACK喪失→exact D1 skip再開、
明示session/challenge失効とcredential bytes保持/FK0を確認する。
local R2 class欠落のみtest adapterで補完する。画像GET/HEADとreal Standard classは
先行R2単体のremote受け入れを参照し、この一式試験の新remote証拠とは扱わない。
Auth SDKの実signin/TOTPは既存leaf検証にあり、ここではcredentialのbytesを照合する。
[限定証拠](evidence/recovery-set-local-2026-10-08.json)。

旧source bundle v1/private combined v2と交換可能ではない。受け入れ済みの旧private runnerを
再実行してこの形式の証拠にしない。実Cloudflareの一式collector/適切な停止方式、運用鍵/
off-host/周期/retention/担当/RPO-RTO採用と最終運用構成は残る。実ユーザー移送とDNSは最後。
