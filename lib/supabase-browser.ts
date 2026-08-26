import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

if (!supabaseUrl || !publishableKey) {
  throw new Error("Supabase public configuration is missing");
}

if (!publishableKey.startsWith("sb_publishable_")) {
  throw new Error("Legacy Supabase API keys are not supported");
}

export const supabase = createClient(supabaseUrl, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "owor-auth",
  },
});

export function oworEmail(staffId: string) {
  return `${staffId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "")}@owor.local`;
}
