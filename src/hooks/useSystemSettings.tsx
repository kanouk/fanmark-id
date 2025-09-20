import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SystemSettings {
  invitation_mode: boolean;
  max_fanmarks_per_user: number;
  premium_pricing: number;
}

export function useSystemSettings() {
  const [settings, setSettings] = useState<SystemSettings>({
    invitation_mode: false,
    max_fanmarks_per_user: 10,
    premium_pricing: 1000,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('setting_key, setting_value')
        .eq('is_public', true);

      if (error) throw error;

      if (data) {
        const settingsMap = data.reduce((acc, { setting_key, setting_value }) => {
          if (setting_key === 'invitation_mode') {
            acc.invitation_mode = setting_value === 'true';
          } else if (setting_key === 'max_fanmarks_per_user') {
            acc.max_fanmarks_per_user = parseInt(setting_value, 10);
          } else if (setting_key === 'premium_pricing') {
            acc.premium_pricing = parseInt(setting_value, 10);
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

  return { settings, loading, refetch: fetchSettings };
}