import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  createSupabaseClient,
  returnFanmarkByFanmarkId,
  type ReturnContext,
} from "../_shared/return-helpers.ts";

interface ReturnRequestBody {
  fanmark_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
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

    const supabase = createSupabaseClient();

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { fanmark_id }: ReturnRequestBody = await req.json();
    
    if (!fanmark_id) {
      return new Response(JSON.stringify({ error: 'fanmark_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for active transfer on this fanmark's license
    const { data: license } = await supabase
      .from('fanmark_licenses')
      .select('id')
      .eq('fanmark_id', fanmark_id)
      .eq('user_id', authData.user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (license) {
      const { data: hasTransfer } = await supabase.rpc('has_active_transfer', {
        license_uuid: license.id
      });

      if (hasTransfer) {
        return new Response(JSON.stringify({ error: 'transfer_in_progress' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    if (!fanmark_id) {
      return new Response(JSON.stringify({ error: 'fanmark_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ctx: ReturnContext = {
      supabase,
      userId: authData.user.id,
    };

    try {
      await returnFanmarkByFanmarkId(ctx, fanmark_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to return fanmark';

      const status = message === 'License not found'
        ? 404
        : message === 'License is not active'
          ? 400
          : 500;

      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Unexpected error in return-fanmark:', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
