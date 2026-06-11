import { createClient } from "@supabase/supabase-js";

function readSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";
}

function readSupabasePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    ""
  );
}

export function isSupabaseAuthConfigured() {
  return Boolean(readSupabaseUrl() && readSupabasePublishableKey());
}

export function createSupabaseAuthClient() {
  const supabaseUrl = readSupabaseUrl();
  const supabaseKey = readSupabasePublishableKey();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase Auth 未配置：请设置 NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY。");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
