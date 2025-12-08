import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 主要クローラーのUser-Agentパターン
const CRAWLER_PATTERNS = [
  // SNS Crawlers
  /facebookexternalhit/i,
  /Facebot/i,
  /Twitterbot/i,
  /LinkedInBot/i,
  /Pinterest/i,
  /Slackbot/i,
  /Discordbot/i,
  /TelegramBot/i,
  /WhatsApp/i,
  /Line/i,
  /Viber/i,
  /Skype/i,
  // Search Engine Crawlers
  /Googlebot/i,
  /bingbot/i,
  /Yahoo/i,
  /DuckDuckBot/i,
  /Baiduspider/i,
  /YandexBot/i,
  // OGP Validators
  /developers\.google\.com/i,
  /redditbot/i,
  /Embedly/i,
  /Quora/i,
  /outbrain/i,
  /vkShare/i,
  /W3C_Validator/i,
  /Google-PageRenderer/i,
];

function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return CRAWLER_PATTERNS.some(pattern => pattern.test(userAgent));
}

// 絵文字をテキストに変換（OGPタイトル用）
function formatFanmarkForTitle(emoji: string): string {
  return emoji || "fanmark";
}

// OGP HTML生成
function generateOgpHtml(params: {
  title: string;
  description: string;
  imageUrl: string;
  url: string;
  siteName: string;
}): string {
  const { title, description, imageUrl, url, siteName } = params;
  
  return `<!DOCTYPE html>
<html lang="ja" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  
  <!-- Primary Meta Tags -->
  <meta name="title" content="${escapeHtml(title)}">
  <meta name="description" content="${escapeHtml(description)}">
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="${escapeHtml(siteName)}">
  <meta property="og:locale" content="ja_JP">
  
  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${escapeHtml(url)}">
  <meta property="twitter:title" content="${escapeHtml(title)}">
  <meta property="twitter:description" content="${escapeHtml(description)}">
  <meta property="twitter:image" content="${escapeHtml(imageUrl)}">
  
  <!-- LINE -->
  <meta property="og:image:alt" content="${escapeHtml(title)}">
  
  <!-- Redirect for non-crawlers (fallback) -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(url)}">
  
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #FFE5E5 0%, #FFF5E5 50%, #E5F0FF 100%);
    }
    .loading {
      text-align: center;
      color: #333;
    }
    .emoji {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="loading">
    <div class="emoji">${escapeHtml(params.title.split(' ')[0] || '✨')}</div>
    <p>Redirecting to fanmark.id...</p>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const userAgent = req.headers.get('user-agent');
    
    // パスからファンマ情報を取得（クエリパラメータで渡される想定）
    const shortId = url.searchParams.get('short_id');
    const emojiPath = url.searchParams.get('emoji_path');
    
    console.log(`[fanmark-ogp] Request: short_id=${shortId}, emoji_path=${emojiPath}, UA=${userAgent}`);
    
    // クローラーでない場合は通常のアプリにリダイレクト
    if (!isCrawler(userAgent)) {
      const redirectUrl = shortId 
        ? `https://fanmark.id/a/${shortId}`
        : emojiPath 
          ? `https://fanmark.id/${emojiPath}`
          : 'https://fanmark.id';
      
      console.log(`[fanmark-ogp] Not a crawler, redirecting to: ${redirectUrl}`);
      
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          'Location': redirectUrl,
        },
      });
    }
    
    console.log(`[fanmark-ogp] Crawler detected: ${userAgent}`);
    
    // Supabase クライアント初期化
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );
    
    let fanmarkData: {
      user_input_fanmark: string;
      short_id: string;
      access_type?: string;
      license_status?: string;
      display_name?: string;
    } | null = null;
    
    // ファンマークデータ取得
    if (shortId) {
      const { data, error } = await supabase
        .rpc('get_fanmark_by_short_id', { shortid_param: shortId });
      
      if (!error && data && data.length > 0) {
        fanmarkData = {
          user_input_fanmark: data[0].user_input_fanmark,
          short_id: data[0].short_id,
          access_type: data[0].access_type,
          license_status: data[0].license_status,
        };
        
        // プロフィール情報も取得（公開されている場合）
        if (data[0].license_id && data[0].access_type === 'profile') {
          const { data: profileData } = await supabase
            .rpc('get_public_emoji_profile', { profile_license_id: data[0].license_id });
          
          if (profileData && profileData.length > 0 && profileData[0].display_name) {
            fanmarkData.display_name = profileData[0].display_name;
          }
        }
      }
    } else if (emojiPath) {
      // 絵文字パスからファンマークを検索
      // emoji_pathはデコード済みの絵文字文字列を想定
      const { data: fanmarkRecord } = await supabase
        .from('fanmarks')
        .select('user_input_fanmark, short_id, status')
        .eq('user_input_fanmark', emojiPath)
        .single();
      
      if (fanmarkRecord) {
        fanmarkData = {
          user_input_fanmark: fanmarkRecord.user_input_fanmark,
          short_id: fanmarkRecord.short_id,
        };
      }
    }
    
    // OGPデータ生成
    const siteUrl = 'https://fanmark.id';
    const baseImageUrl = Deno.env.get('SUPABASE_URL') ?? '';
    
    let title: string;
    let description: string;
    let ogImageUrl: string;
    let pageUrl: string;
    
    if (fanmarkData) {
      const emoji = fanmarkData.user_input_fanmark;
      title = `${emoji} | fanmark.id`;
      
      if (fanmarkData.display_name) {
        description = `${emoji} は ${fanmarkData.display_name} さんのファンマークです`;
      } else if (fanmarkData.license_status === 'active' || fanmarkData.license_status === 'grace') {
        description = `${emoji} のファンマークページ | fanmark.id`;
      } else {
        description = `${emoji} は取得可能です！あなただけのファンマークを今すぐゲット`;
      }
      
      // 動的OGP画像URL
      ogImageUrl = `${baseImageUrl}/functions/v1/generate-ogp-image?emoji=${encodeURIComponent(emoji)}&display_name=${encodeURIComponent(fanmarkData.display_name || '')}`;
      pageUrl = `${siteUrl}/a/${fanmarkData.short_id}`;
    } else {
      // ファンマークが見つからない場合のフォールバック
      title = 'fanmark.id';
      description = 'あなただけのファンマークを見つけよう | 絵文字であなたを表現';
      ogImageUrl = `${siteUrl}/og-default.png`;
      pageUrl = siteUrl;
    }
    
    console.log(`[fanmark-ogp] Generating OGP: title=${title}, imageUrl=${ogImageUrl}`);
    
    const html = generateOgpHtml({
      title,
      description,
      imageUrl: ogImageUrl,
      url: pageUrl,
      siteName: 'fanmark.id',
    });
    
    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    });
    
  } catch (error) {
    console.error('[fanmark-ogp] Error:', error);
    
    // エラー時もフォールバックOGPを返す
    const fallbackHtml = generateOgpHtml({
      title: 'fanmark.id',
      description: 'あなただけのファンマークを見つけよう',
      imageUrl: 'https://fanmark.id/og-default.png',
      url: 'https://fanmark.id',
      siteName: 'fanmark.id',
    });
    
    return new Response(fallbackHtml, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  }
});
