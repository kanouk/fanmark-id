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
          created_at: string
          display_name: string | null
          fanmark_id: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          fanmark_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          fanmark_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      fanmark_licenses: {
        Row: {
          created_at: string
          fanmark_id: string
          id: string
          is_initial_license: boolean
          license_end: string
          license_start: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fanmark_id: string
          id?: string
          is_initial_license?: boolean
          license_end: string
          license_start?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fanmark_id?: string
          id?: string
          is_initial_license?: boolean
          license_end?: string
          license_start?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_fanmark_licenses_fanmark_id"
            columns: ["fanmark_id"]
            isOneToOne: false
            referencedRelation: "fanmark_complete_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_fanmark_licenses_fanmark_id"
            columns: ["fanmark_id"]
            isOneToOne: false
            referencedRelation: "fanmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      fanmark_messageboard_configs: {
        Row: {
          content: string | null
          created_at: string
          fanmark_id: string
          id: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          fanmark_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          fanmark_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      fanmark_password_configs: {
        Row: {
          access_password: string
          created_at: string
          fanmark_id: string
          id: string
          updated_at: string
        }
        Insert: {
          access_password: string
          created_at?: string
          fanmark_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          access_password?: string
          created_at?: string
          fanmark_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      fanmark_profiles: {
        Row: {
          bio: string | null
          created_at: string
          display_name: string | null
          fanmark_id: string
          id: string
          is_public: boolean
          social_links: Json | null
          theme_settings: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          display_name?: string | null
          fanmark_id: string
          id?: string
          is_public?: boolean
          social_links?: Json | null
          theme_settings?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          display_name?: string | null
          fanmark_id?: string
          id?: string
          is_public?: boolean
          social_links?: Json | null
          theme_settings?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fanmark_redirect_configs: {
        Row: {
          created_at: string
          fanmark_id: string
          id: string
          target_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fanmark_id: string
          id?: string
          target_url: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fanmark_id?: string
          id?: string
          target_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      fanmark_tiers: {
        Row: {
          created_at: string
          description: string | null
          emoji_count_max: number
          emoji_count_min: number
          id: string
          initial_license_days: number
          is_active: boolean
          monthly_price_usd: number
          tier_level: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          emoji_count_max: number
          emoji_count_min: number
          id?: string
          initial_license_days: number
          is_active?: boolean
          monthly_price_usd?: number
          tier_level: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          emoji_count_max?: number
          emoji_count_min?: number
          id?: string
          initial_license_days?: number
          is_active?: boolean
          monthly_price_usd?: number
          tier_level?: number
          updated_at?: string
        }
        Relationships: []
      }
      fanmarks: {
        Row: {
          access_type: string
          created_at: string
          emoji_combination: string
          id: string
          normalized_emoji: string
          short_id: string
          status: string
          updated_at: string
        }
        Insert: {
          access_type?: string
          created_at?: string
          emoji_combination: string
          id?: string
          normalized_emoji: string
          short_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          access_type?: string
          created_at?: string
          emoji_combination?: string
          id?: string
          normalized_emoji?: string
          short_id?: string
          status?: string
          updated_at?: string
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
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          emoji_limit: number | null
          id: string
          invitation_perks: Json | null
          invited_by_code: string | null
          is_public_profile: boolean | null
          role: Database["public"]["Enums"]["user_role"] | null
          social_links: Json | null
          subscription_end_date: string | null
          subscription_status: string | null
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          emoji_limit?: number | null
          id?: string
          invitation_perks?: Json | null
          invited_by_code?: string | null
          is_public_profile?: boolean | null
          role?: Database["public"]["Enums"]["user_role"] | null
          social_links?: Json | null
          subscription_end_date?: string | null
          subscription_status?: string | null
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          emoji_limit?: number | null
          id?: string
          invitation_perks?: Json | null
          invited_by_code?: string | null
          is_public_profile?: boolean | null
          role?: Database["public"]["Enums"]["user_role"] | null
          social_links?: Json | null
          subscription_end_date?: string | null
          subscription_status?: string | null
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      public_profile_cache: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          username?: string | null
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
      fanmark_complete_view: {
        Row: {
          access_password: string | null
          access_type: string | null
          created_at: string | null
          current_owner_id: string | null
          emoji_combination: string | null
          fanmark_name: string | null
          has_active_license: boolean | null
          id: string | null
          is_password_protected: boolean | null
          license_end: string | null
          normalized_emoji: string | null
          short_id: string | null
          status: string | null
          target_url: string | null
          text_content: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      generate_safe_display_name: {
        Args: { user_email: string; user_id: string }
        Returns: string
      }
      get_fanmark_by_emoji: {
        Args: { emoji_combo: string }
        Returns: {
          access_password: string
          access_type: string
          emoji_combination: string
          fanmark_name: string
          is_password_protected: boolean
          status: string
          target_url: string
          text_content: string
        }[]
      }
      get_fanmark_ownership_status: {
        Args: { fanmark_license_id: string }
        Returns: {
          has_active_license: boolean
          is_taken: boolean
        }[]
      }
      get_public_emoji_profile: {
        Args: { profile_fanmark_id: string }
        Returns: {
          bio: string
          created_at: string
          display_name: string
          fanmark_id: string
          id: string
          is_public: boolean
          social_links: Json
          theme_settings: Json
          updated_at: string
          user_id: string
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
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_fanmark_licensed: {
        Args: { fanmark_license_id: string }
        Returns: boolean
      }
      is_super_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
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
    }
    Enums: {
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
      user_role: ["user", "admin"],
    },
  },
} as const
