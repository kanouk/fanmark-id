import { supabase } from "@/integrations/supabase/client";

type SocialLinks = Record<string, string> | null;

interface PublicProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

// Type for public profile data (excluding sensitive fields)
export interface PublicProfile {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  social_links: SocialLinks;
  created_at: string;
}

// Type for full profile data (including sensitive fields)
export interface FullProfile extends PublicProfile {
  role: string | null;
  emoji_limit: number | null;
  subscription_status: string | null;
  subscription_end_date: string | null;
  is_public_profile: boolean | null;
  updated_at: string;
}

/**
 * Safely fetch public profile data from the secure public view
 * This function uses the public_profiles view which only exposes safe fields
 */
export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase
    .from<PublicProfileRow>('public_profiles')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // Transform to match PublicProfile interface (add missing fields with null values)
  return {
    ...data,
    user_id: '', // Not exposed in public view for security
    social_links: null, // Not exposed in public view for security
  };
}

/**
 * Fetch multiple public profiles from the secure public view
 */
export async function getPublicProfiles(limit = 10): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from<PublicProfileRow>('public_profiles')
    .select('*')
    .limit(limit);

  if (error || !data) {
    return [];
  }

  // Transform to match PublicProfile interface (add missing fields)
  return data.map(profile => ({
    ...profile,
    user_id: '', // Not exposed in public view for security
    social_links: null, // Not exposed in public view for security
  }));
}

/**
 * Fetch full profile data - only for authenticated users viewing their own profile
 * or authorized users with proper permissions
 */
export async function getFullProfile(userId: string): Promise<FullProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  
  // Only allow users to access their own full profile data
  if (!user || user.id !== userId) {
    throw new Error('Unauthorized access to profile data');
  }

  const { data, error } = await supabase
    .from<FullProfile>('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Sanitize profile data for public consumption
 * Removes sensitive fields that should not be exposed to unauthorized users
 */
export function sanitizeProfileForPublic(profile: FullProfile): PublicProfile {
  const {
    role,
    emoji_limit,
    subscription_status,
    subscription_end_date,
    is_public_profile,
    updated_at,
    ...publicProfile
  } = profile;

  return publicProfile;
}
