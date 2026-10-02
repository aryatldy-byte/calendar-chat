import { createClient } from '@supabase/supabase-js';

// Env vars win; the fallbacks are the project's public URL + anon key
// (the anon key is designed to be public – Row Level Security protects the data).
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qqcjfzcnjrxlkyluycbw.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxY2pmemNuanJ4bGt5bHV5Y2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4ODg5NjQsImV4cCI6MjEwNjQ2NDk2NH0.zD5vNUa8pi43DLK0u0M2m8J5z61HfnMRxmZ2aEDP51Q';

export const supabase = createClient(SUPABASE_URL, supabaseAnonKey);
