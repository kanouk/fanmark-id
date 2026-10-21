import { checkOwnUsernameAvailability, loadOwnProfile } from "@/lib/profile-api";

// Type for simplified user settings (no longer public profile concept)
export interface UserSettings {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  plan_type: 'free' | 'creator' | 'max' | 'business' | 'enterprise' | 'admin';
  preferred_language: 'ja' | 'en' | 'ko' | 'id';
  created_at: string;
  updated_at: string;
  requires_password_setup: boolean;
}

/**
 * Fetch user settings - only for authenticated users viewing their own settings
 */
export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  {
    const profile = await loadOwnProfile();
    if (profile.user_id !== userId) throw new Error('Unauthorized access to user settings');
    return profile as UserSettings;
  }

  // Only allow users to access their own user settings

}

/**
 * Check if a username is available using secure database function
 */
export async function checkUsernameAvailability(username: string, currentUserId?: string): Promise<boolean> {
  if (!username) return false;

  try {
    {
      // The Worker derives the excluded owner from Better Auth, never from this legacy argument.
      void currentUserId;
      return await checkOwnUsernameAvailability(username);
    }

  } catch (error) {
    console.error('Error checking username:', error);
    return false;
  }
}
