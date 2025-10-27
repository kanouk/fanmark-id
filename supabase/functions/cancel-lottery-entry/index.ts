import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  createSupabaseClient,
} from "../_shared/return-helpers.ts";

interface CancelLotteryRequest {
  entry_id: string;
}

serve(async (req) => {
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

    const body = (await req.json()) as CancelLotteryRequest;
    const { entry_id } = body;

    if (!entry_id || typeof entry_id !== 'string') {
      return new Response(JSON.stringify({ error: 'entry_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[cancel-lottery-entry] User ${authData.user.id} canceling entry ${entry_id}`);

    // Get the entry and verify ownership
    const { data: entry, error: fetchError } = await supabase
      .from('fanmark_lottery_entries')
      .select('id, user_id, fanmark_id, entry_status')
      .eq('id', entry_id)
      .single();

    if (fetchError || !entry) {
      console.error('[cancel-lottery-entry] Entry not found:', fetchError);
      return new Response(JSON.stringify({ error: 'Entry not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify ownership
    if (entry.user_id !== authData.user.id) {
      console.warn(`[cancel-lottery-entry] Unauthorized: User ${authData.user.id} attempted to cancel entry ${entry_id} owned by ${entry.user_id}`);
      return new Response(JSON.stringify({ error: 'You do not have permission to cancel this entry' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if entry is pending
    if (entry.entry_status !== 'pending') {
      return new Response(JSON.stringify({ error: `Cannot cancel entry with status: ${entry.entry_status}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cancel the entry
    const { data: updated, error: updateError } = await supabase
      .from('fanmark_lottery_entries')
      .update({
        entry_status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'user_request',
      })
      .eq('id', entry_id)
      .select('id, entry_status, cancelled_at')
      .single();

    if (updateError) {
      console.error('[cancel-lottery-entry] Error updating entry:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to cancel entry' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[cancel-lottery-entry] ✓ Entry cancelled: ${entry_id}`);

    return new Response(JSON.stringify({
      success: true,
      entry_id: updated.id,
      entry_status: updated.entry_status,
      cancelled_at: updated.cancelled_at,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[cancel-lottery-entry] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
