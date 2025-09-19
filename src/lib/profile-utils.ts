import { supabase } from "@/integrations/supabase/client";

// Type for public profile data (excluding sensitive fields)
export interface PublicProfile {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  social_links: any;
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
 * Safely fetch public profile data without exposing sensitive subscription information
 * This function filters out sensitive fields at the application level to prevent
 * accidental exposure of business-critical data to unauthorized users.
 */
export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id,
      user_id,
      username,
      display_name,
      bio,
      avatar_url,
      social_links,
      created_at
    `)
    .eq('username', username)
    .eq('is_public_profile', true)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Fetch multiple public profiles without sensitive data
 */
export async function getPublicProfiles(limit = 10): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id,
      user_id,
      username,
      display_name,
      bio,
      avatar_url,
      social_links,
      created_at
    `)
    .eq('is_public_profile', true)
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data;
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
    .from('profiles')
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