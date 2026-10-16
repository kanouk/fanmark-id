import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const DEFAULT_SUPABASE_URL = import.meta.env.MODE === 'cloudflare-staging'
  ? 'https://synthetic-project.supabase.co'
  : 'https://ppqgtbjykitqtiaisyji.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = import.meta.env.MODE === 'cloudflare-staging'
  ? 'sb_publishable_fixture_only'
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  DEFAULT_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
