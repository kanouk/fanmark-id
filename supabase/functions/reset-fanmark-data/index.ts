import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Verify admin authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if user has admin role
    const { data: adminRole, error: roleError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError || !adminRole) {
      console.error('Unauthorized reset attempt by:', user.email);
      
      // Log unauthorized attempt
      await supabaseClient.from('audit_logs').insert({
        user_id: user.id,
        action: 'UNAUTHORIZED_DATA_RESET_ATTEMPT',
        resource_type: 'system',
        metadata: {
          timestamp: new Date().toISOString(),
          email: user.email,
          security_level: 'CRITICAL_RISK',
        },
      });

      return new Response(
        JSON.stringify({ error: 'Unauthorized: Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Admin data reset initiated by:', user.email);

    // Delete in order to respect foreign key constraints
    const deletedCounts = {
      fanmark_basic_configs: 0,
      fanmark_redirect_configs: 0,
      fanmark_messageboard_configs: 0,
      fanmark_password_configs: 0,
      fanmark_profiles: 0,
      fanmark_favorites: 0,
      fanmark_licenses: 0,
      fanmarks: 0,
    };

    // Delete config tables first (they reference licenses)
    const { count: basicConfigCount } = await supabaseClient
      .from('fanmark_basic_configs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('*', { count: 'exact', head: true });
    deletedCounts.fanmark_basic_configs = basicConfigCount || 0;

    const { count: redirectConfigCount } = await supabaseClient
      .from('fanmark_redirect_configs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('*', { count: 'exact', head: true });
    deletedCounts.fanmark_redirect_configs = redirectConfigCount || 0;

    const { count: messageboardConfigCount } = await supabaseClient
      .from('fanmark_messageboard_configs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('*', { count: 'exact', head: true });
    deletedCounts.fanmark_messageboard_configs = messageboardConfigCount || 0;

    const { count: passwordConfigCount } = await supabaseClient
      .from('fanmark_password_configs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('*', { count: 'exact', head: true });
    deletedCounts.fanmark_password_configs = passwordConfigCount || 0;

    const { count: profilesCount } = await supabaseClient
      .from('fanmark_profiles')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('*', { count: 'exact', head: true });
    deletedCounts.fanmark_profiles = profilesCount || 0;

    const { count: favoritesCount } = await supabaseClient
      .from('fanmark_favorites')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('*', { count: 'exact', head: true });
    deletedCounts.fanmark_favorites = favoritesCount || 0;

    // Delete licenses (they reference fanmarks)
    const { count: licensesCount } = await supabaseClient
      .from('fanmark_licenses')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('*', { count: 'exact', head: true });
    deletedCounts.fanmark_licenses = licensesCount || 0;

    // Finally delete fanmarks
    const { count: fanmarksCount } = await supabaseClient
      .from('fanmarks')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .select('*', { count: 'exact', head: true });
    deletedCounts.fanmarks = fanmarksCount || 0;

    const totalDeleted = Object.values(deletedCounts).reduce((a, b) => a + b, 0);

    // Log successful reset
    await supabaseClient.from('audit_logs').insert({
      user_id: user.id,
      action: 'ADMIN_DATA_RESET',
      resource_type: 'system',
      metadata: {
        timestamp: new Date().toISOString(),
        deletedCounts,
        totalDeleted,
        security_level: 'ADMIN_VERIFIED',
      },
    });

    console.log('Data reset completed:', deletedCounts);

    return new Response(
      JSON.stringify({
        success: true,
        deletedCounts,
        totalDeleted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in reset-fanmark-data:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
