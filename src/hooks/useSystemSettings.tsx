import { useState, useEffect, useCallback } from 'react';

import { fetchSystemSettingsFromWorker, updateSystemSettingInWorker } from '@/lib/system-settings-api';

export interface SystemSettings {
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
    creator_stripe_price_id: '',
    max_stripe_price_id: '',
    business_stripe_price_id: '',
    stripe_mode: 'test',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      {
        const values = await fetchSystemSettingsFromWorker({ includePrivate });
        const settingsMap: Partial<SystemSettings> = {};
        for (const [key, value] of Object.entries(values)) {
          if (key === 'invitation_mode' || key === 'social_login_enabled') {
            if (value !== 'true' && value !== 'false') throw new Error('invalid_system_setting');
            settingsMap[key] = value === 'true';
          } else if (key === 'stripe_mode') {
            if (value !== 'test' && value !== 'live') throw new Error('invalid_system_setting');
            settingsMap.stripe_mode = value;
          } else if (key === 'creator_stripe_price_id' || key === 'max_stripe_price_id' ||
              key === 'business_stripe_price_id') {
            settingsMap[key] = value;
          } else if (key === 'enterprise_fanmarks_limit') {
            settingsMap.enterprise_fanmarks_limit = Number(value);
          } else if (key === 'enterprise_pricing') {
            settingsMap.enterprise_pricing = Number(value);
          } else if (key === 'free_fanmarks_limit') {
            settingsMap.free_fanmarks_limit = Number(value);
          } else if (key === 'creator_fanmarks_limit') {
            settingsMap.creator_fanmarks_limit = Number(value);
          } else if (key === 'max_fanmarks_limit') {
            settingsMap.max_fanmarks_limit = Number(value);
          } else if (key === 'business_fanmarks_limit') {
            settingsMap.business_fanmarks_limit = Number(value);
          } else if (key === 'premium_pricing') {
            settingsMap.premium_pricing = Number(value);
          } else if (key === 'max_pricing') {
            settingsMap.max_pricing = Number(value);
          } else if (key === 'business_pricing') {
            settingsMap.business_pricing = Number(value);
          } else if (key === 'max_emoji_characters') {
            settingsMap.max_emoji_characters = Number(value);
          }
        }
        if (Object.values(settingsMap).some((value) => typeof value === 'number' && !Number.isSafeInteger(value))) {
          throw new Error('invalid_system_setting');
        }
        setSettings(prev => ({ ...prev, ...settingsMap }));
        setError(null);
        return;
      }

    } catch (error) {
      console.error('Error fetching system settings:', error);
      setError('system_settings_unavailable');
    } finally {
      setLoading(false);
    }
  }, [includePrivate]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const updateSetting = async <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    try {
      {
        await updateSystemSettingInWorker({
          key,
          value: String(value),
          expectedValue: String(settings[key]),
        });
        setSettings(prev => ({ ...prev, [key]: value }));
        await fetchSettings();
        return true;
      }

    } catch (error) {
      console.error(`Error updating system setting "${key}":`, error);
      return false;
    }
  };

  return { settings, loading, error, refetch: fetchSettings, updateSetting };
}
