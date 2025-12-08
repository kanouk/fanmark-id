# 動的OGP実装ガイド

## 概要

fanmark.idの各ファンマークURL（`/a/:shortId` や絵文字パス）に対して、SNSでシェアされた際に魅力的なプレビューカードを表示するための動的OGP（Open Graph Protocol）システムを実装しています。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    SNSクローラー                              │
│         (Twitter, Facebook, Discord, LINE等)                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Edge Function: fanmark-ogp                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. User-Agent でクローラー判定                        │   │
│  │ 2. クローラー → 動的OGP HTML返却                      │   │
│  │ 3. 通常ブラウザ → SPAにリダイレクト                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│    クローラーの場合     │           │   通常ブラウザの場合   │
│                       │           │                       │
│  ・OGPメタタグHTML     │           │  ・302リダイレクト    │
│  ・動的画像URL参照     │           │  ・SPAアプリへ誘導    │
└───────────────────────┘           └───────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│           Edge Function: generate-ogp-image                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ・絵文字を含むSVG画像を動的生成                       │   │
│  │ ・表示名がある場合は含める                            │   │
│  │ ・グラデーション背景 + スパークル装飾                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Edge Functions

### 1. fanmark-ogp

**エンドポイント**: `/functions/v1/fanmark-ogp`

**パラメータ**:
- `short_id`: ファンマークのショートID
- `emoji_path`: 絵文字パス（URLエンコード済み）

**機能**:
1. User-Agentからクローラーを判定
2. クローラーの場合：
   - Supabaseからファンマーク情報を取得
   - 動的OGPメタタグを含むHTMLを返却
   - プロフィール情報があれば表示名も含める
3. 通常ブラウザの場合：
   - SPAアプリへ302リダイレクト

**対応クローラー**:
- SNS: Twitterbot, facebookexternalhit, Discordbot, Slackbot, LINE, WhatsApp等
- 検索エンジン: Googlebot, bingbot, Yahoo等
- バリデータ: Facebook Debugger, Twitter Card Validator等

### 2. generate-ogp-image

**エンドポイント**: `/functions/v1/generate-ogp-image`

**パラメータ**:
- `emoji`: 表示する絵文字
- `display_name`: 表示名（オプション）

**機能**:
- 1200x630のSVG画像を動的生成
- グラデーション背景（ピンク→ピーチ→ライトブルー）
- 絵文字を大きく中央に配置
- 表示名がある場合は下部に表示
- スパークル装飾を追加

## OGPタグ構成

生成されるOGPタグ:

```html
<!-- Primary Meta Tags -->
<meta name="title" content="🎵 | fanmark.id">
<meta name="description" content="🎵 のファンマークページ | fanmark.id">

<!-- Open Graph / Facebook -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://fanmark.id/a/abc123">
<meta property="og:title" content="🎵 | fanmark.id">
<meta property="og:description" content="🎵 のファンマークページ | fanmark.id">
<meta property="og:image" content="https://...supabase.co/functions/v1/generate-ogp-image?emoji=🎵">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<!-- Twitter -->
<meta property="twitter:card" content="summary_large_image">
<meta property="twitter:title" content="🎵 | fanmark.id">
<meta property="twitter:image" content="...">
```

## 使用方法

### Cloudflare Workers / Vercel での設定

現在のSPA構成では、クローラーをEdge Functionに誘導するためのリバースプロキシ設定が必要です。

**Cloudflare Workers例**:

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const userAgent = request.headers.get('user-agent') || '';
    
    // クローラー判定
    const isCrawler = /bot|crawler|spider|facebook|twitter|discord|slack|line|whatsapp/i.test(userAgent);
    
    // ファンマークパスの判定
    const isFanmarkPath = url.pathname.startsWith('/a/') || 
                          /^\/[^\w\/]/.test(url.pathname); // 絵文字パス
    
    if (isCrawler && isFanmarkPath) {
      // OGP Edge Functionへプロキシ
      const ogpUrl = new URL('https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/fanmark-ogp');
      
      if (url.pathname.startsWith('/a/')) {
        ogpUrl.searchParams.set('short_id', url.pathname.replace('/a/', ''));
      } else {
        ogpUrl.searchParams.set('emoji_path', decodeURIComponent(url.pathname.slice(1)));
      }
      
      return fetch(ogpUrl, {
        headers: { 'user-agent': userAgent }
      });
    }
    
    // 通常リクエストはオリジンへ
    return fetch(request);
  }
};
```

## テスト方法

### 1. OGP Debuggers

- **Facebook**: https://developers.facebook.com/tools/debug/
- **Twitter**: https://cards-dev.twitter.com/validator
- **LinkedIn**: https://www.linkedin.com/post-inspector/
- **Discord**: Discord内でURLを貼り付け

### 2. curlでのテスト

```bash
# クローラーとしてリクエスト
curl -H "User-Agent: Twitterbot/1.0" \
  "https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/fanmark-ogp?short_id=abc123"

# OGP画像生成テスト
curl "https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/generate-ogp-image?emoji=🎵" \
  -o test-ogp.svg
```

## キャッシュ戦略

- **OGP HTML**: 5分（CDN: 10分）
- **OGP画像**: 1時間（CDN: 24時間）

これにより、プロフィール更新時も比較的早く反映されつつ、クローラーへの応答は高速に保たれます。

## フォールバック

エラー時やファンマークが見つからない場合:
- デフォルトのOGP画像（`/og-default.png`）を使用
- 汎用的なタイトル・説明文を表示

## 今後の拡張案

1. **PNG画像生成**: SVGをサポートしないプラットフォーム向けにCanvas API使用
2. **カスタムテーマ**: プロフィールのテーマ設定をOGP画像に反映
3. **アクセス分析**: OGP経由のアクセスを個別に集計
