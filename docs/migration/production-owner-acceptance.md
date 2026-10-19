# 一般公開を閉じたG5の本人確認

`receipt_only`は一般画面とAuthを閉じるため、G4はTLS/maintenance/no-storeとStripeの保存を
確認する。実アプリ・既存accountのOAuth/管理者MFA、Resend署名付き配信の検査は、以下の
本人確認モードをG5で有効にして行う。本番ではまだ有効にしていない。

## 先に固定する境界

G3の全件照合、移送後schema pin/backup、旧source停止/受信引継ぎと外部効果照合、G4の
両provider登録・遠隔鍵保管・実binding鍵一致が揃った後、所有者がG5への進行を明示する。
モード有効化前にprivate `open-writer`票へ`potentialBusinessWritesStarted=true`と
`sourceRevertForbidden=true`、run/commit/runtime/全settings hash/時刻をfsyncする。
有効化直後にResendの遅着が保存される可能性もあるため、この時点から前進復旧側として扱う。
本人が画面を開かなかったことだけを根拠に旧側へ戻さない。

このモードとWebhook登録・鍵設定・import新規操作を同時に進めない。それぞれのguardは
owner backendがdisabled以外なら新規操作を拒否する。読取専用inspectは残す。

## 有効化・発行・本人操作

1. 固定した成功CIのapp source/全bindings/既存秘密値・閉鎖route/全Cron・source停止を再確認する。
   公開用のbase configは`PRODUCTION_OWNER_ACCEPTANCE_BACKEND=disabled`で固定する。
   既存varsを保持し、この1変数だけを`owner-browser-v1`へ変更する一度だけのprivate配備票を作る。
   ACK不明ならGETで確認し、同じ配備を再送しない。
2. app version100%と元設定との差分1件を独立GETで確認する。新versionを固定し、所有する
   短命operatorの`OWNER`を同じappの`ProductionOwnerAcceptanceService`へbindする。
   `productionOwnerAcceptanceProxySource`の期限/bearer・固定run・期待version・本人リンク期限を設定する。
3. 固定POST `/issue`は本文なしで1回だけ呼ぶ。返る`browserUrl`をstdout/argv/file/チャットへ
   出さず、同じMacの本人用ブラウザで開く。汎用proxy/任意URL/外部fetchは作らない。
4. リンクは最大10分・その配備版だけ有効。fragmentを直ちに消し、同originの空POSTとBearerを
   検証してhost限定のSecure/HttpOnly cookieへ交換する。Apple form POSTを扱うためSameSite=None。
   通常のAuth/state/PKCE/MFA/role/Origin検証は引き続き要求する。本人リンクはログイン済み扱いを与えない。
5. 専用の新しいブラウザcontextで、既存UUID/provider subjectのログイン、管理者MFA、画像/保護URL/
   旧PWA更新を確認する。確認中はOAuthの新user作成と招待signupを無効にし、未知subjectを新userへ
   追加しない。必要な業務確認の対象と外部副作用は実施票で先に指定する。
6. 別のcookieなしcontextで一般画面/Auth APIの503/no-storeが続くことを確認する。

`production-owner-acceptance.ts`は既存の公開ページ用秘密鍵を、独立した固定purposeと
厳格なrun/nonce/version/期限だけのHMACへ使用する。鍵の生成・export・任意文字列の署名はしない。
リンク/cookieは鍵の実値を含まない。期限超過・別version・別origin・誤鍵・改変・重複cookieを拒否する。

## 受信と書込みの扱い

cookieを持つブラウザだけが通常routerへ進む。全応答はno-store/Vary Cookieとし、
通常のwriter enter/leave、復旧fence、認証/権限を通す。通常Cronと通知wakeは閉じたまま。
`RECOVERY_WRITE_FREEZE`または実fenceの取得は、本人のアクセスも止める。

同じG5モード中は、固定Resend POST `/api/webhooks/resend/broadcast-delivery`も
既存handlerへ進める。Svix署名/期限/本文制限を通常どおり検証し、配信台帳へ保存する。
これを受信保存だけのG4と混同しない。Stripe以外の新受信・配信status更新を含め、G5の
最初の実更新/応答不明を記録する。provider ID/署名event/永続行と実配送を独立照合するまで一般公開しない。

## 終了

所有operatorのversion/bindingを照合して除去する。owner backendをdisabledへ戻すと、
新しいCF versionとselectorの両方で旧リンク/cookieを失効できる。鍵rotationは不要。
他のG5条件を満たしてから一般write/dispatcher/通知/Cron/aliasを順に再開する。
途中中止はメンテナンスを保ち、前進復旧票で照合する。

native試験はHTTP入口・cookie条件・通常writer/fence/停止・G4/importの拒否とbinding-only
issuerを確認する。実本番ブラウザのOAuth・MFA・署名配信・公開受入れを先取りしない。
