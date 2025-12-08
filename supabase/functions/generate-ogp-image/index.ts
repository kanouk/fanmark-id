import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SVGベースのOGP画像生成
function generateOgpSvg(emoji: string, displayName?: string): string {
  const safeEmoji = escapeXml(emoji || '✨');
  const safeDisplayName = displayName ? escapeXml(displayName) : '';
  
  // 絵文字の文字数に応じてフォントサイズを調整
  const emojiLength = [...emoji].length;
  let emojiFontSize = 180;
  if (emojiLength > 3) {
    emojiFontSize = 140;
  } else if (emojiLength > 2) {
    emojiFontSize = 160;
  }
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- グラデーション背景 -->
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FFE5E5"/>
      <stop offset="50%" style="stop-color:#FFF5E5"/>
      <stop offset="100%" style="stop-color:#E5F0FF"/>
    </linearGradient>
    
    <!-- 装飾用の円グラデーション -->
    <radialGradient id="circleGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.8"/>
      <stop offset="100%" style="stop-color:#ffffff;stop-opacity:0"/>
    </radialGradient>
    
    <!-- シャドウフィルター -->
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.1"/>
    </filter>
    
    <!-- テキストシャドウ -->
    <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.15"/>
    </filter>
  </defs>
  
  <!-- 背景 -->
  <rect width="1200" height="630" fill="url(#bgGradient)"/>
  
  <!-- 装飾的な円 -->
  <circle cx="100" cy="100" r="200" fill="url(#circleGlow)" opacity="0.5"/>
  <circle cx="1100" cy="530" r="250" fill="url(#circleGlow)" opacity="0.4"/>
  <circle cx="900" cy="80" r="120" fill="url(#circleGlow)" opacity="0.3"/>
  
  <!-- メインの白いカード -->
  <rect x="100" y="80" width="1000" height="470" rx="32" ry="32" fill="white" filter="url(#shadow)"/>
  
  <!-- 絵文字表示 -->
  <text x="600" y="${displayName ? '280' : '340'}" 
        font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif" 
        font-size="${emojiFontSize}" 
        text-anchor="middle" 
        dominant-baseline="central"
        filter="url(#textShadow)">
    ${safeEmoji}
  </text>
  
  ${displayName ? `
  <!-- 表示名 -->
  <text x="600" y="420" 
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif" 
        font-size="36" 
        font-weight="600"
        fill="#333333"
        text-anchor="middle" 
        dominant-baseline="central">
    ${safeDisplayName}
  </text>
  ` : ''}
  
  <!-- サイトロゴ/名前 -->
  <text x="600" y="${displayName ? '500' : '480'}" 
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif" 
        font-size="24" 
        font-weight="500"
        fill="#888888"
        text-anchor="middle">
    fanmark.id
  </text>
  
  <!-- 装飾的なスパークル -->
  <g fill="#FFD700" opacity="0.6">
    <polygon points="180,180 185,195 200,195 188,205 193,220 180,210 167,220 172,205 160,195 175,195" transform="scale(0.8)"/>
    <polygon points="1020,150 1025,165 1040,165 1028,175 1033,190 1020,180 1007,190 1012,175 1000,165 1015,165" transform="scale(0.7)"/>
    <polygon points="950,450 955,465 970,465 958,475 963,490 950,480 937,490 942,475 930,465 945,465" transform="scale(0.6)"/>
  </g>
</svg>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const emoji = url.searchParams.get('emoji') || '✨';
    const displayName = url.searchParams.get('display_name') || '';
    
    console.log(`[generate-ogp-image] Generating image for emoji: ${emoji}, displayName: ${displayName}`);
    
    // SVG生成
    const svg = generateOgpSvg(emoji, displayName || undefined);
    
    // SVGをそのまま返す（多くのSNSはSVGをサポート）
    // 注意：一部のプラットフォームはPNG/JPGを要求する場合がある
    return new Response(svg, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
    
  } catch (error) {
    console.error('[generate-ogp-image] Error:', error);
    
    // エラー時はシンプルなフォールバックSVGを返す
    const fallbackSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#FFE5E5"/>
  <text x="600" y="280" font-size="120" text-anchor="middle">✨</text>
  <text x="600" y="400" font-family="sans-serif" font-size="48" fill="#333" text-anchor="middle">fanmark.id</text>
</svg>`;
    
    return new Response(fallbackSvg, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/svg+xml',
      },
    });
  }
});
