import { supabase } from "@/integrations/supabase/client";

// Type for simplified user settings (no longer public profile concept)
export interface UserSettings {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  plan_type: 'free' | 'creator' | 'business' | 'enterprise' | 'admin';
  created_at: string;
  updated_at: string;
}

/**
 * Fetch user settings - only for authenticated users viewing their own settings
 */
export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const { data: { user } } = await supabase.auth.getUser();
  
  // Only allow users to access their own user settings
  if (!user || user.id !== userId) {
    throw new Error('Unauthorized access to user settings');
  }

  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as UserSettings;
}

/**
 * Check if a username is available using secure database function
 */
export async function checkUsernameAvailability(username: string, currentUserId?: string): Promise<boolean> {
  if (!username) return false;
  
  try {
    const { data, error } = await supabase.rpc('check_username_availability_secure', {
      username_to_check: username,
      current_user_id: currentUserId || null
    });

    if (error) throw error;
    return data === true;
  } catch (error) {
    console.error('Error checking username:', error);
    return false;
  }
}
