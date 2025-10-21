import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/return-helpers.ts";

interface NotificationEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  retry_count: number;
}

interface NotificationRule {
  id: string;
  event_type: string;
  channel: string;
  template_id: string;
  template_version: number;
  delay_seconds: number;
  priority: number;
  segment_filter: Record<string, unknown> | null;
  cooldown_window_seconds: number | null;
  max_per_user: number | null;
  cancel_condition: string | null;
  enabled: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting notification event processing");

    // Fetch pending events
    const { data: events, error: eventsError } = await supabase
      .from("notification_events")
      .select("*")
      .eq("status", "pending")
      .lte("trigger_at", new Date().toISOString())
      .lt("retry_count", 3)
      .order("trigger_at", { ascending: true })
      .limit(50);

    if (eventsError) {
      console.error("Error fetching events:", eventsError);
      throw eventsError;
    }

    if (!events || events.length === 0) {
      console.log("No pending events to process");
      return new Response(
        JSON.stringify({ processed: 0, message: "No pending events" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${events.length} events`);

    let processedCount = 0;
    let failedCount = 0;

    for (const event of events as NotificationEvent[]) {
      try {
        // Mark as processing immediately
        await supabase
          .from("notification_events")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", event.id);

        await processEvent(supabase, event);
        processedCount++;
      } catch (error) {
        console.error(`Failed to process event ${event.id}:`, error);
        failedCount++;
        
        // Update event status to failed
        await supabase
          .from("notification_events")
          .update({
            status: "failed",
            error_reason: error instanceof Error ? error.message : "Unknown error",
            retry_count: event.retry_count + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", event.id);
      }
    }

    console.log(`Processed: ${processedCount}, Failed: ${failedCount}`);

    return new Response(
      JSON.stringify({ processed: processedCount, failed: failedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Process notification events error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processEvent(supabase: any, event: NotificationEvent): Promise<void> {
  console.log(`Processing event ${event.id} of type ${event.event_type}`);

  // Fetch matching rules
  const { data: rules, error: rulesError } = await supabase
    .from("notification_rules")
    .select("*")
    .eq("event_type", event.event_type)
    .eq("enabled", true)
    .order("priority", { ascending: false });

  if (rulesError) {
    console.error("Error fetching rules:", rulesError);
    throw rulesError;
  }

  if (!rules || rules.length === 0) {
    console.log(`No active rules found for event type ${event.event_type}`);
    await supabase
      .from("notification_events")
      .update({
        status: "processed",
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return;
  }

  console.log(`Found ${rules.length} matching rules for event ${event.id}`);

  let appliedCount = 0;
  for (const rule of rules as NotificationRule[]) {
    try {
      await applyRule(supabase, event, rule);
      appliedCount++;
      console.log(`Successfully applied rule ${rule.id} for event ${event.id}`);
    } catch (error) {
      console.error(`Failed to apply rule ${rule.id} for event ${event.id}:`, error);
      // Continue with other rules even if one fails
    }
  }

  console.log(`Applied ${appliedCount}/${rules.length} rules for event ${event.id}`);

  // Mark event as processed
  await supabase
    .from("notification_events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
}

async function applyRule(
  supabase: any,
  event: NotificationEvent,
  rule: NotificationRule
): Promise<void> {
  console.log(`Applying rule ${rule.id} for event ${event.id}`);

  // Extract user_id from payload
  const userId = event.payload.user_id as string;
  if (!userId) {
    console.log("No user_id in event payload, skipping");
    return;
  }

  // Check segment filter if specified
  if (rule.segment_filter && Object.keys(rule.segment_filter).length > 0) {
    const matchesSegment = await checkSegmentFilter(supabase, userId, rule.segment_filter);
    if (!matchesSegment) {
      console.log(`User ${userId} does not match segment filter`);
      return;
    }
  }

  // Check cooldown window
  if (rule.cooldown_window_seconds) {
    const cooldownStart = new Date(Date.now() - rule.cooldown_window_seconds * 1000).toISOString();
    let cooldownQuery = supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("rule_id", rule.id)
      .gte("created_at", cooldownStart)
      .limit(1);

    const fanmarkId = event.payload?.fanmark_id as string | undefined;
    if (fanmarkId) {
      cooldownQuery = cooldownQuery.eq("payload->>fanmark_id", fanmarkId);
    }

    const { data: recentNotifications } = await cooldownQuery;

    if (recentNotifications && recentNotifications.length > 0) {
      console.log(
        `User ${userId} is in cooldown period for rule ${rule.id}${
          fanmarkId ? ` (fanmark ${fanmarkId})` : ""
        }`,
      );
      return;
    }
  }

  // Check max_per_user
  if (rule.max_per_user) {
    let maxQuery = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("rule_id", rule.id);

    const fanmarkIdForLimit = event.payload?.fanmark_id as string | undefined;
    if (fanmarkIdForLimit) {
      maxQuery = maxQuery.eq("payload->>fanmark_id", fanmarkIdForLimit);
    }

    const { count } = await maxQuery;

    if (count && count >= rule.max_per_user) {
      console.log(
        `User ${userId} has reached max notifications for rule ${rule.id}${
          fanmarkIdForLimit ? ` (fanmark ${fanmarkIdForLimit})` : ""
        }`,
      );
      return;
    }
  }

  // Check user preferences
  const { data: preferences } = await supabase
    .from("notification_preferences")
    .select("enabled")
    .eq("user_id", userId)
    .eq("channel", rule.channel)
    .eq("event_type", event.event_type)
    .maybeSingle();

  if (preferences && !preferences.enabled) {
    console.log(`User ${userId} has disabled notifications for ${event.event_type} on ${rule.channel}`);
    return;
  }

  // Render template
  let renderedContent: any;
  try {
    const language = (event.payload?.language as string) || 'ja';
    const { data: rendered, error: renderError } = await supabase
      .rpc('render_notification_template', {
        template_id_param: rule.template_id,
        template_version_param: rule.template_version,
        payload_param: event.payload,
        language_param: language
      });

    if (renderError) {
      console.error(`Template rendering failed for rule ${rule.id}:`, renderError);
      // Fallback: create minimal payload
      renderedContent = {
        title: event.event_type,
        body: JSON.stringify(event.payload),
        summary: null
      };
    } else {
      renderedContent = rendered;
    }
  } catch (error) {
    console.error(`Exception during template rendering for rule ${rule.id}:`, error);
    // Fallback
    renderedContent = {
      title: event.event_type,
      body: JSON.stringify(event.payload),
      summary: null
    };
  }

  // Merge additional metadata for the final payload
  const extendedPayload = {
    ...renderedContent,
    link: event.payload?.link ?? null,
    fanmark_id: event.payload?.fanmark_id ?? null,
    fanmark_short_id: event.payload?.fanmark_short_id ?? null,
    metadata: event.payload ?? {},
  };

  // Calculate trigger time with delay
  const triggeredAt = new Date(Date.now() + rule.delay_seconds * 1000);
  const now = new Date().toISOString();

  // Determine status: immediate in-app notifications are 'delivered', others are 'pending'
  const isImmediate = rule.channel === 'in_app' && rule.delay_seconds === 0;
  const notificationStatus = isImmediate ? 'delivered' : 'pending';
  const deliveredAt = isImmediate ? now : null;

  // Create notification with rendered content
  const { error: insertError } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      event_id: event.id,
      rule_id: rule.id,
      template_id: rule.template_id,
      template_version: rule.template_version,
      channel: rule.channel,
      priority: rule.priority,
      payload: extendedPayload,
      status: notificationStatus,
      triggered_at: triggeredAt.toISOString(),
      delivered_at: deliveredAt,
    });

  if (insertError) {
    console.error(`Error creating notification for user ${userId}:`, insertError);
    throw insertError;
  }

  console.log(`Created notification for user ${userId} with status ${notificationStatus}`);
}

async function checkSegmentFilter(
  supabase: any,
  userId: string,
  segmentFilter: Record<string, unknown>
): Promise<boolean> {
  // Basic segment filter implementation
  // Can be extended based on specific requirements
  
  const { data: userSettings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!userSettings) {
    return false;
  }

  // Check if user settings match segment filter
  for (const [key, value] of Object.entries(segmentFilter)) {
    if (userSettings[key] !== value) {
      return false;
    }
  }

  return true;
}
