import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  createSupabaseClient,
} from "../_shared/return-helpers.ts";

interface ApplyLotteryRequest {
  fanmark_id: string;
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

    const body = (await req.json()) as ApplyLotteryRequest;
    const { fanmark_id } = body;

    if (!fanmark_id || typeof fanmark_id !== 'string') {
      return new Response(JSON.stringify({ error: 'fanmark_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[apply-fanmark-lottery] User ${authData.user.id} applying for fanmark ${fanmark_id}`);

    // Get the fanmark's grace period license
    const { data: license, error: licenseError } = await supabase
      .from('fanmark_licenses')
      .select(`
        id,
        fanmark_id,
        user_id,
        status,
        grace_expires_at,
        fanmarks!inner(
          id,
          user_input_fanmark,
          short_id
        )
      `)
      .eq('fanmark_id', fanmark_id)
      .eq('status', 'grace')
      .gt('grace_expires_at', new Date().toISOString())
      .maybeSingle();

    if (licenseError) {
      console.error('[apply-fanmark-lottery] Error fetching license:', licenseError);
      return new Response(JSON.stringify({ error: 'Failed to fetch license information' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!license) {
      return new Response(JSON.stringify({ error: 'Fanmark is not in grace period or not available for lottery' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for existing entry (pending or cancelled)
    const { data: existingEntry, error: checkError } = await supabase
      .from('fanmark_lottery_entries')
      .select('id, entry_status')
      .eq('fanmark_id', fanmark_id)
      .eq('user_id', authData.user.id)
      .eq('license_id', license.id)
      .maybeSingle();

    if (checkError) {
      console.error('[apply-fanmark-lottery] Error checking existing entry:', checkError);
      return new Response(JSON.stringify({ error: 'Failed to check existing entry' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let entry;
    
    if (existingEntry) {
      if (existingEntry.entry_status === 'pending') {
        return new Response(JSON.stringify({ error: 'You have already applied for this fanmark' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else if (existingEntry.entry_status === 'cancelled') {
        // Reuse cancelled entry by updating it to pending
        console.log(`[apply-fanmark-lottery] Reusing cancelled entry ${existingEntry.id}`);
        const { data: updatedEntry, error: updateError } = await supabase
          .from('fanmark_lottery_entries')
          .update({
            entry_status: 'pending',
            applied_at: new Date().toISOString(),
            lottery_probability: 1.0,
          })
          .eq('id', existingEntry.id)
          .select('id, lottery_probability, applied_at')
          .single();

        if (updateError) {
          console.error('[apply-fanmark-lottery] Error updating entry:', updateError);
          return new Response(JSON.stringify({ error: 'Failed to update lottery entry' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        entry = updatedEntry;
      }
    } else {
      // Create new lottery entry
      const { data: newEntry, error: entryError } = await supabase
        .from('fanmark_lottery_entries')
        .insert({
          fanmark_id,
          user_id: authData.user.id,
          license_id: license.id,
          lottery_probability: 1.0,
          entry_status: 'pending',
        })
        .select('id, lottery_probability, applied_at')
        .single();

      if (entryError) {
        console.error('[apply-fanmark-lottery] Error creating entry:', entryError);
        return new Response(JSON.stringify({ error: 'Failed to create lottery entry' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      entry = newEntry;
    }

    // Get total entry count for this fanmark
    const { count: totalEntries, error: countError } = await supabase
      .from('fanmark_lottery_entries')
      .select('*', { count: 'exact', head: true })
      .eq('fanmark_id', fanmark_id)
      .eq('license_id', license.id)
      .eq('entry_status', 'pending');

    if (countError) {
      console.warn('[apply-fanmark-lottery] Error counting entries:', countError);
    }

    // Create notification event
    const { error: notificationError } = await supabase.rpc('create_notification_event', {
      event_type_param: 'lottery_application_submitted',
      payload_param: {
        user_id: authData.user.id,
        fanmark_id,
        fanmark_name: license.fanmarks.user_input_fanmark,
        entry_id: entry.id,
        grace_expires_at: license.grace_expires_at,
      },
      source_param: 'edge_function',
    });

    if (notificationError) {
      console.warn('[apply-fanmark-lottery] Failed to create notification:', notificationError);
    }

    console.log(`[apply-fanmark-lottery] ✓ Entry created: ${entry.id}`);

    return new Response(JSON.stringify({
      success: true,
      entry_id: entry.id,
      fanmark_id,
      lottery_probability: entry.lottery_probability,
      total_entries_count: totalEntries || 1,
      grace_expires_at: license.grace_expires_at,
      applied_at: entry.applied_at,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[apply-fanmark-lottery] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
