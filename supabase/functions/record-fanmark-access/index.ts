import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AccessRequestBody {
  fanmark_id: string;
  short_id: string;
  referrer?: string | null;
  user_agent?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
}

// User-Agent解析
function parseUserAgent(ua: string | null | undefined): {
  device_type: string;
  browser: string;
  os: string;
} {
  if (!ua) {
    return { device_type: 'unknown', browser: 'unknown', os: 'unknown' };
  }

  // デバイスタイプ判定
  let device_type = 'desktop';
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    device_type = 'tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|windows.*phone|blackberry/i.test(ua)) {
    device_type = 'mobile';
  }

  // ブラウザ判定
  let browser = 'other';
  if (/edg/i.test(ua)) {
    browser = 'edge';
  } else if (/chrome/i.test(ua) && !/edg/i.test(ua)) {
    browser = 'chrome';
  } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
    browser = 'safari';
  } else if (/firefox/i.test(ua)) {
    browser = 'firefox';
  } else if (/opera|opr/i.test(ua)) {
    browser = 'opera';
  }

  // OS判定
  let os = 'other';
  if (/windows/i.test(ua)) {
    os = 'windows';
  } else if (/macintosh|mac os/i.test(ua)) {
    os = 'macos';
  } else if (/android/i.test(ua)) {
    os = 'android';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    os = 'ios';
  } else if (/linux/i.test(ua)) {
    os = 'linux';
  }

  return { device_type, browser, os };
}

// リファラードメイン抽出
function extractDomain(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// リファラーカテゴリ分類
function categorizeReferrer(domain: string | null): string {
  if (!domain) return 'direct';

  const searchEngines = ['google.com', 'google.co.jp', 'bing.com', 'yahoo.com', 'yahoo.co.jp', 'duckduckgo.com', 'baidu.com', 'yandex.ru'];
  const socialPlatforms = ['twitter.com', 'x.com', 't.co', 'instagram.com', 'facebook.com', 'fb.com', 'tiktok.com', 'line.me', 'linkedin.com', 'pinterest.com', 'reddit.com', 'youtube.com'];

  const lowerDomain = domain.toLowerCase();

  if (searchEngines.some(se => lowerDomain.includes(se))) {
    return 'search';
  }
  if (socialPlatforms.some(sp => lowerDomain.includes(sp))) {
    return 'social';
  }
  return 'other';
}

// visitor_hash生成（プライバシー考慮：IPは使用しない）
async function generateVisitorHash(
  userAgent: string | null | undefined,
  fanmarkId: string,
  date: string
): Promise<string> {
  const input = `${userAgent || 'unknown'}-${fanmarkId}-${date}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

// 日付を取得（UTC）
function getUtcDate(): string {
  return new Date().toISOString().split('T')[0];
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const body: AccessRequestBody = await req.json();
    const { fanmark_id, short_id, referrer, user_agent, utm_source, utm_medium, utm_campaign } = body;

    // バリデーション
    if (!fanmark_id || !short_id) {
      return new Response(JSON.stringify({ error: 'fanmark_id and short_id are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const today = getUtcDate();
    const visitorHash = await generateVisitorHash(user_agent, fanmark_id, today);

    // レート制限チェック（同一visitor_hashから5分以内のアクセスはスキップ）
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentAccess } = await supabase
      .from('fanmark_access_logs')
      .select('id')
      .eq('visitor_hash', visitorHash)
      .eq('fanmark_id', fanmark_id)
      .gte('accessed_at', fiveMinutesAgo)
      .limit(1);

    if (recentAccess && recentAccess.length > 0) {
      // レート制限によりスキップ
      return new Response(JSON.stringify({ success: true, recorded: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // User-Agent解析
    const { device_type, browser, os } = parseUserAgent(user_agent);

    // リファラー解析
    const referrer_domain = extractDomain(referrer);
    const referrer_category = categorizeReferrer(referrer_domain);

    // 現在のライセンス取得
    const { data: licenseData } = await supabase
      .from('fanmark_licenses')
      .select('id')
      .eq('fanmark_id', fanmark_id)
      .in('status', ['active', 'grace'])
      .order('created_at', { ascending: false })
      .limit(1);

    const license_id = licenseData?.[0]?.id || null;

    // fanmark_access_logs に挿入
    const { error: insertError } = await supabase
      .from('fanmark_access_logs')
      .insert({
        fanmark_id,
        license_id,
        referrer: referrer || null,
        referrer_domain,
        referrer_category,
        user_agent: user_agent || null,
        device_type,
        browser,
        os,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        visitor_hash: visitorHash,
      });

    if (insertError) {
      console.error('Failed to insert access log:', insertError);
      throw new Error('Failed to record access');
    }

    // ユニーク訪問者かどうかをチェック（本日の同一visitor_hashの最初のアクセスかどうか）
    const startOfDay = `${today}T00:00:00.000Z`;
    const { data: todayVisits } = await supabase
      .from('fanmark_access_logs')
      .select('id')
      .eq('visitor_hash', visitorHash)
      .eq('fanmark_id', fanmark_id)
      .gte('accessed_at', startOfDay)
      .limit(2);

    const isUniqueVisitor = (todayVisits?.length || 0) === 1;

    // fanmark_access_daily_stats を UPSERT
    // デバイス/リファラーカウントをインクリメント
    const deviceColumn = `device_${device_type}` as const;
    const referrerColumn = `referrer_${referrer_category}` as const;

    // まず既存レコードを取得
    const { data: existingStats } = await supabase
      .from('fanmark_access_daily_stats')
      .select('*')
      .eq('fanmark_id', fanmark_id)
      .eq('stat_date', today)
      .single();

    if (existingStats) {
      // 既存レコードを更新
      const updateData: Record<string, number | string> = {
        access_count: (existingStats.access_count || 0) + 1,
        updated_at: new Date().toISOString(),
      };

      if (isUniqueVisitor) {
        updateData.unique_visitors = (existingStats.unique_visitors || 0) + 1;
      }

      // デバイスカウント
      if (device_type === 'mobile') {
        updateData.device_mobile = (existingStats.device_mobile || 0) + 1;
      } else if (device_type === 'tablet') {
        updateData.device_tablet = (existingStats.device_tablet || 0) + 1;
      } else if (device_type === 'desktop') {
        updateData.device_desktop = (existingStats.device_desktop || 0) + 1;
      }

      // リファラーカウント
      if (referrer_category === 'direct') {
        updateData.referrer_direct = (existingStats.referrer_direct || 0) + 1;
      } else if (referrer_category === 'search') {
        updateData.referrer_search = (existingStats.referrer_search || 0) + 1;
      } else if (referrer_category === 'social') {
        updateData.referrer_social = (existingStats.referrer_social || 0) + 1;
      } else if (referrer_category === 'other') {
        updateData.referrer_other = (existingStats.referrer_other || 0) + 1;
      }

      const { error: updateError } = await supabase
        .from('fanmark_access_daily_stats')
        .update(updateData)
        .eq('id', existingStats.id);

      if (updateError) {
        console.error('Failed to update daily stats:', updateError);
      }
    } else {
      // 新規レコードを作成
      const insertData: Record<string, any> = {
        fanmark_id,
        license_id,
        stat_date: today,
        access_count: 1,
        unique_visitors: 1, // 新規レコード = 最初の訪問者
        device_mobile: device_type === 'mobile' ? 1 : 0,
        device_tablet: device_type === 'tablet' ? 1 : 0,
        device_desktop: device_type === 'desktop' ? 1 : 0,
        referrer_direct: referrer_category === 'direct' ? 1 : 0,
        referrer_search: referrer_category === 'search' ? 1 : 0,
        referrer_social: referrer_category === 'social' ? 1 : 0,
        referrer_other: referrer_category === 'other' ? 1 : 0,
      };

      const { error: statsInsertError } = await supabase
        .from('fanmark_access_daily_stats')
        .insert(insertData);

      if (statsInsertError) {
        console.error('Failed to insert daily stats:', statsInsertError);
      }
    }

    return new Response(JSON.stringify({ success: true, recorded: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in record-fanmark-access:', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
