export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          request_id: string | null
          resource_id: string | null
          resource_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          request_id?: string | null
          resource_id?: string | null
          resource_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      emoji_master: {
        Row: {
          category: string | null
          codepoints: string[]
          created_at: string
          emoji: string
          id: string
          keywords: string[]
          short_name: string
          sort_order: number | null
          subcategory: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          codepoints: string[]
          created_at?: string
          emoji: string
          id?: string
          keywords?: string[]
          short_name: string
          sort_order?: number | null
          subcategory?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          codepoints?: string[]
          created_at?: string
          emoji?: string
          id?: string
          keywords?: string[]
          short_name?: string
          sort_order?: number | null
          subcategory?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      enterprise_user_settings: {
        Row: {
          created_at: string
          created_by: string | null
          custom_fanmarks_limit: number | null
          custom_pricing: number | null
          id: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_fanmarks_limit?: number | null
          custom_pricing?: number | null
          id?: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_fanmarks_limit?: number | null
          custom_pricing?: number | null
          id?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fanmark_availability_rules: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_available: boolean
          price_usd: number | null
          priority: number
          rule_config: Json
          rule_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_available?: boolean
          price_usd?: number | null
          priority: number
          rule_config?: Json
          rule_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_available?: boolean
          price_usd?: number | null
          priority?: number
          rule_config?: Json
          rule_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      fanmark_basic_configs: {
        Row: {
          access_type: string
          created_at: string
          fanmark_name: string | null
          id: string
          license_id: string
          updated_at: string
        }
        Insert: {
          access_type?: string
          created_at?: string
          fanmark_name?: string | null
          id?: string
          license_id: string
          updated_at?: string
        }
        Update: {
          access_type?: string
          created_at?: string
          fanmark_name?: string | null
          id?: string
          license_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_basic_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "fanmark_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_basic_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "recent_active_fanmarks"
            referencedColumns: ["license_id"]
          },
        ]
      }
      fanmark_discoveries: {
        Row: {
          availability_status: string
          emoji_ids: string[]
          fanmark_id: string | null
          favorite_count: number
          first_seen_at: string
          id: string
          last_seen_at: string
          normalized_emoji_ids: string[]
          search_count: number
        }
        Insert: {
          availability_status?: string
          emoji_ids: string[]
          fanmark_id?: string | null
          favorite_count?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          normalized_emoji_ids: string[]
          search_count?: number
        }
        Update: {
          availability_status?: string
          emoji_ids?: string[]
          fanmark_id?: string | null
          favorite_count?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          normalized_emoji_ids?: string[]
          search_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_discoveries_fanmark_id_fkey"
            columns: ["fanmark_id"]
            isOneToOne: false
            referencedRelation: "fanmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      fanmark_events: {
        Row: {
          created_at: string
          discovery_id: string | null
          event_type: string
          id: number
          normalized_emoji_ids: string[]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          discovery_id?: string | null
          event_type: string
          id?: number
          normalized_emoji_ids: string[]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          discovery_id?: string | null
          event_type?: string
          id?: number
          normalized_emoji_ids?: string[]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_events_discovery_id_fkey"
            columns: ["discovery_id"]
            isOneToOne: false
            referencedRelation: "fanmark_discoveries"
            referencedColumns: ["id"]
          },
        ]
      }
      fanmark_favorites: {
        Row: {
          created_at: string
          discovery_id: string
          fanmark_id: string | null
          id: string
          normalized_emoji_ids: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          discovery_id: string
          fanmark_id?: string | null
          id?: string
          normalized_emoji_ids: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          discovery_id?: string
          fanmark_id?: string | null
          id?: string
          normalized_emoji_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_favorites_discovery_id_fkey"
            columns: ["discovery_id"]
            isOneToOne: false
            referencedRelation: "fanmark_discoveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_favorites_fanmark_id_fkey"
            columns: ["fanmark_id"]
            isOneToOne: false
            referencedRelation: "fanmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      fanmark_licenses: {
        Row: {
          created_at: string
          excluded_at: string | null
          excluded_from_plan: string | null
          fanmark_id: string
          grace_expires_at: string | null
          id: string
          is_initial_license: boolean
          is_returned: boolean
          license_end: string | null
          license_start: string
          plan_excluded: boolean | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          excluded_at?: string | null
          excluded_from_plan?: string | null
          fanmark_id: string
          grace_expires_at?: string | null
          id?: string
          is_initial_license?: boolean
          is_returned?: boolean
          license_end?: string | null
          license_start?: string
          plan_excluded?: boolean | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          excluded_at?: string | null
          excluded_from_plan?: string | null
          fanmark_id?: string
          grace_expires_at?: string | null
          id?: string
          is_initial_license?: boolean
          is_returned?: boolean
          license_end?: string | null
          license_start?: string
          plan_excluded?: boolean | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_fanmark_licenses_fanmark_id"
            columns: ["fanmark_id"]
            isOneToOne: false
            referencedRelation: "fanmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      fanmark_lottery_entries: {
        Row: {
          applied_at: string
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          entry_status: string
          fanmark_id: string
          id: string
          license_id: string
          lottery_executed_at: string | null
          lottery_probability: number
          updated_at: string
          user_id: string
          won_at: string | null
        }
        Insert: {
          applied_at?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          entry_status?: string
          fanmark_id: string
          id?: string
          license_id: string
          lottery_executed_at?: string | null
          lottery_probability?: number
          updated_at?: string
          user_id: string
          won_at?: string | null
        }
        Update: {
          applied_at?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          entry_status?: string
          fanmark_id?: string
          id?: string
          license_id?: string
          lottery_executed_at?: string | null
          lottery_probability?: number
          updated_at?: string
          user_id?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_lottery_entries_fanmark_id_fkey"
            columns: ["fanmark_id"]
            isOneToOne: false
            referencedRelation: "fanmarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_lottery_entries_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "fanmark_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_lottery_entries_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "recent_active_fanmarks"
            referencedColumns: ["license_id"]
          },
        ]
      }
      fanmark_lottery_history: {
        Row: {
          created_at: string
          executed_at: string
          execution_method: string
          fanmark_id: string
          id: string
          license_id: string
          probability_distribution: Json
          random_seed: string | null
          total_entries: number
          winner_entry_id: string | null
          winner_user_id: string | null
        }
        Insert: {
          created_at?: string
          executed_at?: string
          execution_method?: string
          fanmark_id: string
          id?: string
          license_id: string
          probability_distribution?: Json
          random_seed?: string | null
          total_entries: number
          winner_entry_id?: string | null
          winner_user_id?: string | null
        }
        Update: {
          created_at?: string
          executed_at?: string
          execution_method?: string
          fanmark_id?: string
          id?: string
          license_id?: string
          probability_distribution?: Json
          random_seed?: string | null
          total_entries?: number
          winner_entry_id?: string | null
          winner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_lottery_history_fanmark_id_fkey"
            columns: ["fanmark_id"]
            isOneToOne: false
            referencedRelation: "fanmarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_lottery_history_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "fanmark_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_lottery_history_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "recent_active_fanmarks"
            referencedColumns: ["license_id"]
          },
          {
            foreignKeyName: "fanmark_lottery_history_winner_entry_id_fkey"
            columns: ["winner_entry_id"]
            isOneToOne: false
            referencedRelation: "fanmark_lottery_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      fanmark_messageboard_configs: {
        Row: {
          content: string | null
          created_at: string
          id: string
          license_id: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          license_id: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          license_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_messageboard_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "fanmark_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_messageboard_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "recent_active_fanmarks"
            referencedColumns: ["license_id"]
          },
        ]
      }
      fanmark_password_configs: {
        Row: {
          access_password: string
          created_at: string
          id: string
          is_enabled: boolean
          license_id: string
          updated_at: string
        }
        Insert: {
          access_password: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          license_id: string
          updated_at?: string
        }
        Update: {
          access_password?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          license_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_password_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "fanmark_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_password_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "recent_active_fanmarks"
            referencedColumns: ["license_id"]
          },
        ]
      }
      fanmark_profiles: {
        Row: {
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          is_public: boolean
          license_id: string
          social_links: Json | null
          theme_settings: Json | null
          updated_at: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_public?: boolean
          license_id: string
          social_links?: Json | null
          theme_settings?: Json | null
          updated_at?: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_public?: boolean
          license_id?: string
          social_links?: Json | null
          theme_settings?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_profiles_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "fanmark_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_profiles_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "recent_active_fanmarks"
            referencedColumns: ["license_id"]
          },
        ]
      }
      fanmark_redirect_configs: {
        Row: {
          created_at: string
          id: string
          license_id: string
          target_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          license_id: string
          target_url: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          license_id?: string
          target_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fanmark_redirect_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "fanmark_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fanmark_redirect_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: true
            referencedRelation: "recent_active_fanmarks"
            referencedColumns: ["license_id"]
          },
        ]
      }
      fanmark_tier_extension_prices: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          months: number
          price_yen: number
          tier_level: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          months: number
          price_yen: number
          tier_level: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          months?: number
          price_yen?: number
          tier_level?: number
          updated_at?: string
        }
        Relationships: []
      }
      fanmark_tiers: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          emoji_count_max: number
          emoji_count_min: number
          id: string
          initial_license_days: number | null
          is_active: boolean
          monthly_price_usd: number
          tier_level: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          emoji_count_max: number
          emoji_count_min: number
          id?: string
          initial_license_days?: number | null
          is_active?: boolean
          monthly_price_usd?: number
          tier_level: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          emoji_count_max?: number
          emoji_count_min?: number
          id?: string
          initial_license_days?: number | null
          is_active?: boolean
          monthly_price_usd?: number
          tier_level?: number
          updated_at?: string
        }
        Relationships: []
      }
      fanmarks: {
        Row: {
          created_at: string
          emoji_ids: string[]
          id: string
          normalized_emoji: string
          normalized_emoji_ids: string[]
          short_id: string
          status: string
          tier_level: number
          updated_at: string
          user_input_fanmark: string
        }
        Insert: {
          created_at?: string
          emoji_ids?: string[]
          id?: string
          normalized_emoji: string
          normalized_emoji_ids?: string[]
          short_id: string
          status?: string
          tier_level: number
          updated_at?: string
          user_input_fanmark: string
        }
        Update: {
          created_at?: string
          emoji_ids?: string[]
          id?: string
          normalized_emoji?: string
          normalized_emoji_ids?: string[]
          short_id?: string
          status?: string
          tier_level?: number
          updated_at?: string
          user_input_fanmark?: string
        }
        Relationships: []
      }
      invitation_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number
          special_perks: Json | null
          updated_at: string
          used_count: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number
          special_perks?: Json | null
          updated_at?: string
          used_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number
          special_perks?: Json | null
          updated_at?: string
          used_count?: number
        }
        Relationships: []
      }
      notification_events: {
        Row: {
          created_at: string
          dedupe_key: string | null
          error_reason: string | null
          event_type: string
          event_version: number
          id: string
          payload: Json
          payload_schema: string | null
          processed_at: string | null
          retry_count: number
          source: string
          status: string
          trigger_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          error_reason?: string | null
          event_type: string
          event_version?: number
          id?: string
          payload?: Json
          payload_schema?: string | null
          processed_at?: string | null
          retry_count?: number
          source: string
          status?: string
          trigger_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          error_reason?: string | null
          event_type?: string
          event_version?: number
          id?: string
          payload?: Json
          payload_schema?: string | null
          processed_at?: string | null
          retry_count?: number
          source?: string
          status?: string
          trigger_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          event_type: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          event_type?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          event_type?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_rules: {
        Row: {
          cancel_condition: string | null
          channel: string
          cooldown_window_seconds: number | null
          created_at: string
          created_by: string | null
          delay_seconds: number
          enabled: boolean
          event_type: string
          id: string
          max_per_user: number | null
          priority: number
          segment_filter: Json | null
          template_id: string
          template_version: number
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          cancel_condition?: string | null
          channel: string
          cooldown_window_seconds?: number | null
          created_at?: string
          created_by?: string | null
          delay_seconds?: number
          enabled?: boolean
          event_type: string
          id?: string
          max_per_user?: number | null
          priority?: number
          segment_filter?: Json | null
          template_id: string
          template_version?: number
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          cancel_condition?: string | null
          channel?: string
          cooldown_window_seconds?: number | null
          created_at?: string
          created_by?: string | null
          delay_seconds?: number
          enabled?: boolean
          event_type?: string
          id?: string
          max_per_user?: number | null
          priority?: number
          segment_filter?: Json | null
          template_id?: string
          template_version?: number
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      notification_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          is_active: boolean
          language: string
          payload_schema: Json | null
          summary: string | null
          template_id: string
          title: string | null
          updated_at: string
          version: number
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          id?: string
          is_active?: boolean
          language?: string
          payload_schema?: Json | null
          summary?: string | null
          template_id: string
          title?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          language?: string
          payload_schema?: Json | null
          summary?: string | null
          template_id?: string
          title?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          channel: string
          created_at: string
          delivered_at: string | null
          error_reason: string | null
          event_id: string | null
          expires_at: string | null
          id: string
          payload: Json
          priority: number
          read_at: string | null
          read_via: string | null
          retry_count: number
          rule_id: string | null
          status: string
          template_id: string
          template_version: number
          triggered_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          delivered_at?: string | null
          error_reason?: string | null
          event_id?: string | null
          expires_at?: string | null
          id?: string
          payload?: Json
          priority?: number
          read_at?: string | null
          read_via?: string | null
          retry_count?: number
          rule_id?: string | null
          status?: string
          template_id: string
          template_version?: number
          triggered_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          delivered_at?: string | null
          error_reason?: string | null
          event_id?: string | null
          expires_at?: string | null
          id?: string
          payload?: Json
          priority?: number
          read_at?: string | null
          read_via?: string | null
          retry_count?: number
          rule_id?: string | null
          status?: string
          template_id?: string
          template_version?: number
          triggered_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications_history: {
        Row: {
          archived_at: string
          id: string
          original_data: Json
        }
        Insert: {
          archived_at?: string
          id: string
          original_data: Json
        }
        Update: {
          archived_at?: string
          id?: string
          original_data?: Json
        }
        Relationships: []
      }
      reserved_emoji_patterns: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          pattern: string
          price_yen: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          pattern: string
          price_yen: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          pattern?: string
          price_yen?: number
          updated_at?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          setting_key: string
          setting_value: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          setting_key: string
          setting_value: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          setting_key?: string
          setting_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          invited_by_code: string | null
          plan_type: Database["public"]["Enums"]["user_plan"]
          preferred_language: Database["public"]["Enums"]["user_language"]
          requires_password_setup: boolean
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          invited_by_code?: string | null
          plan_type?: Database["public"]["Enums"]["user_plan"]
          preferred_language?: Database["public"]["Enums"]["user_language"]
          requires_password_setup?: boolean
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          invited_by_code?: string | null
          plan_type?: Database["public"]["Enums"]["user_plan"]
          preferred_language?: Database["public"]["Enums"]["user_language"]
          requires_password_setup?: boolean
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_invited_by_code_fkey"
            columns: ["invited_by_code"]
            isOneToOne: false
            referencedRelation: "invitation_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      user_subscriptions: {
        Row: {
          amount: number | null
          cancel_at_period_end: boolean | null
          created_at: string
          currency: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          interval: string | null
          interval_count: number | null
          price_id: string | null
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          cancel_at_period_end?: boolean | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          interval?: string | null
          interval_count?: number | null
          price_id?: string | null
          product_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          cancel_at_period_end?: boolean | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          interval?: string | null
          interval_count?: number | null
          price_id?: string | null
          product_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          referral_source: string | null
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          referral_source?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          referral_source?: string | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      recent_active_fanmarks: {
        Row: {
          display_emoji: string | null
          fanmark_id: string | null
          fanmark_short_id: string | null
          license_created_at: string | null
          license_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_fanmark_licenses_fanmark_id"
            columns: ["fanmark_id"]
            isOneToOne: false
            referencedRelation: "fanmarks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_fanmark_favorite: {
        Args: { input_emoji_ids: string[] }
        Returns: boolean
      }
      archive_old_notifications: {
        Args: { days_old?: number }
        Returns: number
      }
      check_fanmark_availability: {
        Args: { input_emoji_ids: string[] }
        Returns: Json
      }
      check_fanmark_availability_secure: {
        Args: { fanmark_uuid: string }
        Returns: boolean
      }
      check_username_availability_secure: {
        Args: { current_user_id?: string; username_to_check: string }
        Returns: boolean
      }
      classify_fanmark_tier: {
        Args: { input_emoji_ids: string[] }
        Returns: {
          display_name: string
          initial_license_days: number
          monthly_price_usd: number
          tier_level: number
        }[]
      }
      count_fanmark_emoji_units: { Args: { input: string }; Returns: number }
      create_notification_event: {
        Args: {
          dedupe_key_param?: string
          event_type_param: string
          payload_param: Json
          source_param?: string
          trigger_at_param?: string
        }
        Returns: string
      }
      generate_safe_display_name: {
        Args: { user_email: string; user_id: string }
        Returns: string
      }
      get_fanmark_by_emoji: {
        Args: { input_emoji_ids: string[] }
        Returns: {
          access_type: string
          emoji_ids: string[]
          fanmark_name: string
          id: string
          is_password_protected: boolean
          short_id: string
          status: string
          target_url: string
          text_content: string
          user_input_fanmark: string
        }[]
      }
      get_fanmark_by_short_id: {
        Args: { shortid_param: string }
        Returns: {
          access_type: string
          emoji_ids: string[]
          fanmark_name: string
          grace_expires_at: string
          id: string
          is_password_protected: boolean
          is_returned: boolean
          license_end: string
          license_id: string
          license_status: string
          short_id: string
          status: string
          target_url: string
          text_content: string
          user_input_fanmark: string
        }[]
      }
      get_fanmark_complete_data: {
        Args: { emoji_ids_param?: string[]; fanmark_id_param?: string }
        Returns: {
          access_type: string
          created_at: string
          current_grace_expires_at: string
          current_license_status: string
          current_owner_id: string
          emoji_ids: string[]
          fanmark_name: string
          has_active_license: boolean
          has_user_lottery_entry: boolean
          id: string
          is_blocked_for_registration: boolean
          is_password_protected: boolean
          license_end: string
          license_id: string
          lottery_entry_count: number
          next_available_at: string
          normalized_emoji: string
          short_id: string
          status: string
          target_url: string
          text_content: string
          updated_at: string
          user_input_fanmark: string
          user_lottery_entry_id: string
        }[]
      }
      get_fanmark_details_by_short_id: {
        Args: { shortid_param: string }
        Returns: {
          current_grace_expires_at: string
          current_is_returned: boolean
          current_license_end: string
          current_license_id: string
          current_license_start: string
          current_license_status: string
          current_owner_display_name: string
          current_owner_id: string
          current_owner_username: string
          emoji_ids: string[]
          fanmark_created_at: string
          fanmark_id: string
          first_acquired_date: string
          first_owner_display_name: string
          first_owner_username: string
          has_user_lottery_entry: boolean
          is_currently_active: boolean
          is_favorited: boolean
          license_history: Json
          lottery_entry_count: number
          normalized_emoji: string
          short_id: string
          user_input_fanmark: string
          user_lottery_entry_id: string
        }[]
      }
      get_fanmark_ownership_status: {
        Args: { fanmark_license_id: string }
        Returns: {
          has_active_license: boolean
          is_taken: boolean
        }[]
      }
      get_favorite_fanmarks: {
        Args: never
        Returns: {
          access_type: string
          availability_status: string
          current_license_end: string
          current_license_start: string
          current_license_status: string
          current_owner_display_name: string
          current_owner_username: string
          discovery_id: string
          emoji_ids: string[]
          fanmark_id: string
          fanmark_name: string
          favorite_count: number
          favorite_id: string
          favorited_at: string
          is_password_protected: boolean
          normalized_emoji_ids: string[]
          search_count: number
          sequence_key: string
          short_id: string
          target_url: string
          text_content: string
        }[]
      }
      get_public_emoji_profile: {
        Args: { profile_license_id: string }
        Returns: {
          bio: string
          created_at: string
          display_name: string
          license_id: string
          social_links: Json
          theme_settings: Json
          updated_at: string
        }[]
      }
      get_public_fanmark_profile: {
        Args: { profile_fanmark_id: string }
        Returns: {
          bio: string
          created_at: string
          display_name: string
          fanmark_id: string
          id: string
          social_links: Json
          theme_settings: Json
          updated_at: string
        }[]
      }
      get_unread_notification_count: {
        Args: { user_id_param?: string }
        Returns: number
      }
      get_waitlist_email_by_id: {
        Args: { waitlist_id: string }
        Returns: string
      }
      get_waitlist_secure: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          created_at: string
          email_hash: string
          id: string
          referral_source: string
          status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_fanmark_licensed: {
        Args: { fanmark_license_id: string }
        Returns: boolean
      }
      is_fanmark_password_protected: {
        Args: { fanmark_uuid: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      link_fanmark_discovery: {
        Args: { new_fanmark_id: string; normalized_ids: string[] }
        Returns: undefined
      }
      list_recent_fanmarks: {
        Args: { p_limit?: number }
        Returns: {
          display_emoji: string
          fanmark_id: string
          fanmark_short_id: string
          license_created_at: string
          license_id: string
        }[]
      }
      mark_all_notifications_read: {
        Args: { read_via_param?: string; user_id_param: string }
        Returns: number
      }
      mark_notification_read: {
        Args: { notification_id_param: string; read_via_param?: string }
        Returns: boolean
      }
      normalize_emoji_ids: { Args: { input_ids: string[] }; Returns: string[] }
      record_fanmark_search: {
        Args: { input_emoji_ids: string[] }
        Returns: string
      }
      remove_fanmark_favorite: {
        Args: { input_emoji_ids: string[] }
        Returns: boolean
      }
      render_notification_template: {
        Args: {
          language_param?: string
          payload_param: Json
          template_id_param: string
          template_version_param: number
        }
        Returns: Json
      }
      search_fanmarks_with_lottery: {
        Args: { input_emoji_ids: string[] }
        Returns: Json
      }
      seq_key: { Args: { normalized_ids: string[] }; Returns: string }
      toggle_fanmark_favorite: {
        Args: { fanmark_uuid: string }
        Returns: boolean
      }
      upsert_fanmark_discovery: {
        Args: { increment_search?: boolean; input_emoji_ids: string[] }
        Returns: string
      }
      upsert_fanmark_password_config: {
        Args: {
          enable_password: boolean
          license_uuid: string
          new_password: string
        }
        Returns: string
      }
      use_invitation_code: {
        Args: { code_to_use: string }
        Returns: {
          error_message: string
          special_perks: Json
          success: boolean
        }[]
      }
      validate_invitation_code: {
        Args: { code_to_check: string }
        Returns: {
          is_valid: boolean
          remaining_uses: number
          special_perks: Json
        }[]
      }
      verify_fanmark_password: {
        Args: { fanmark_uuid: string; provided_password: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      user_language: "en" | "ja" | "ko" | "id"
      user_plan:
        | "free"
        | "creator"
        | "max"
        | "business"
        | "enterprise"
        | "admin"
      user_role: "user" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      user_language: ["en", "ja", "ko", "id"],
      user_plan: ["free", "creator", "max", "business", "enterprise", "admin"],
      user_role: ["user", "admin"],
    },
  },
} as const
