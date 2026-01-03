import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SystemSettings {
  invitation_mode: boolean;
  social_login_enabled: boolean;
  free_fanmarks_limit: number;
  creator_fanmarks_limit: number;
  max_fanmarks_limit: number;
  business_fanmarks_limit: number;
  enterprise_fanmarks_limit: number;
  premium_pricing: number;
  max_pricing: number;
  business_pricing: number;
  enterprise_pricing: number;
  max_emoji_characters: number;
  grace_period_days: number;
  maintenance_mode: boolean;
  maintenance_message: string;
  maintenance_end_time: string | null;
  creator_stripe_price_id: string;
  max_stripe_price_id: string;
  business_stripe_price_id: string;
  stripe_mode: 'test' | 'live';
}

export function useSystemSettings(options?: { includePrivate?: boolean }) {
  const includePrivate = options?.includePrivate ?? false;
  const [settings, setSettings] = useState<SystemSettings>({
    invitation_mode: false,
    social_login_enabled: true,
    free_fanmarks_limit: 3,
    creator_fanmarks_limit: 10,
    max_fanmarks_limit: 500,
    business_fanmarks_limit: 50,
    enterprise_fanmarks_limit: 100,
    premium_pricing: 1000,
    max_pricing: 10000,
    business_pricing: 10000,
    enterprise_pricing: 50000,
    max_emoji_characters: 5,
    grace_period_days: 7,
    maintenance_mode: false,
    maintenance_message: '',
    maintenance_end_time: null,
    creator_stripe_price_id: '',
    max_stripe_price_id: '',
    business_stripe_price_id: '',
    stripe_mode: 'test',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      let query = supabase
        .from('system_settings')
        .select('setting_key, setting_value');

      if (!includePrivate) {
        query = query.eq('is_public', true);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (data) {
        const settingsMap = data.reduce((acc, { setting_key, setting_value }) => {
          if (setting_key === 'invitation_mode') {
            acc.invitation_mode = setting_value === 'true';
          } else if (setting_key === 'social_login_enabled') {
            acc.social_login_enabled = setting_value === 'true';
          } else if (setting_key === 'free_fanmarks_limit') {
            acc.free_fanmarks_limit = parseInt(setting_value, 10);
          } else if (setting_key === 'creator_fanmarks_limit') {
            acc.creator_fanmarks_limit = parseInt(setting_value, 10);
          } else if (setting_key === 'max_fanmarks_limit') {
            acc.max_fanmarks_limit = parseInt(setting_value, 10);
          } else if (setting_key === 'business_fanmarks_limit') {
            acc.business_fanmarks_limit = parseInt(setting_value, 10);
          } else if (setting_key === 'enterprise_fanmarks_limit') {
            acc.enterprise_fanmarks_limit = parseInt(setting_value, 10);
          } else if (setting_key === 'premium_pricing') {
            acc.premium_pricing = parseInt(setting_value, 10);
          } else if (setting_key === 'max_pricing') {
            acc.max_pricing = parseInt(setting_value, 10);
          } else if (setting_key === 'business_pricing') {
            acc.business_pricing = parseInt(setting_value, 10);
          } else if (setting_key === 'enterprise_pricing') {
            acc.enterprise_pricing = parseInt(setting_value, 10);
          } else if (setting_key === 'max_emoji_characters') {
            acc.max_emoji_characters = parseInt(setting_value, 10);
          } else if (setting_key === 'grace_period_days') {
            acc.grace_period_days = parseInt(setting_value, 10);
          } else if (setting_key === 'maintenance_mode') {
            acc.maintenance_mode = setting_value === 'true';
          } else if (setting_key === 'maintenance_message') {
            acc.maintenance_message = setting_value;
          } else if (setting_key === 'maintenance_end_time') {
            acc.maintenance_end_time = setting_value ? setting_value : null;
          } else if (setting_key === 'creator_stripe_price_id') {
            acc.creator_stripe_price_id = setting_value;
          } else if (setting_key === 'max_stripe_price_id') {
            acc.max_stripe_price_id = setting_value;
          } else if (setting_key === 'business_stripe_price_id') {
            acc.business_stripe_price_id = setting_value;
          } else if (setting_key === 'stripe_mode') {
            acc.stripe_mode = setting_value as 'test' | 'live';
          }
          return acc;
        }, {} as Partial<SystemSettings>);

        setSettings(prev => ({ ...prev, ...settingsMap }));
      }
    } catch (error) {
      console.error('Error fetching system settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    try {
      const stringValue = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
      const { error } = await supabase
        .from('system_settings')
        .update({ setting_value: stringValue })
        .eq('setting_key', key);

      if (error) throw error;

      setSettings(prev => ({ ...prev, [key]: value }));
      await fetchSettings();
      return true;
    } catch (error) {
      console.error(`Error updating system setting "${key}":`, error);
      return false;
    }
  };

  return { settings, loading, refetch: fetchSettings, updateSetting };
}
