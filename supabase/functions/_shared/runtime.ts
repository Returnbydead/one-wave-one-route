import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-sync-secret, x-owor-bootstrap-secret",
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
};

export type Claim = {
  claimed: boolean;
  run_id?: string;
  cycle_id?: string;
  cursor_value?: number;
};

export function env(name: string, fallback = ""): string {
  return (Deno.env.get(name) ?? fallback).trim();
}
export function adminClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  let managedSecret = "";
  try {
    const values = Object.values(JSON.parse(env("SUPABASE_SECRET_KEYS", "{}")) as Record<string, unknown>);
    managedSecret = values.find((value) => typeof value === "string" && value.startsWith("sb_secret_")) as string ?? "";
  } catch {
    managedSecret = "";
  }
  const key = env("SUPABASE_SECRET_KEY") || managedSecret;
  if (!url || !key) throw new Error("Supabase admin environment is incomplete");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

export function authorizeSync(req: Request): boolean {
  const expected = env("SYNC_SECRET");
  const supplied = req.headers.get("x-sync-secret")?.trim() ?? "";
  return Boolean(expected && supplied && constantTimeEqual(expected, supplied));
}

export function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "cache-control": "no-store", "content-type": "application/json" },
  });
}

export async function claimSync(db: SupabaseClient, source: "putaway" | "soh"): Promise<Claim> {
  const { data, error } = await db.rpc("claim_inventory_sync", {
    p_source: source,
    p_lock_seconds: 240,
  });
  if (error) throw error;
  return data as Claim;
}

export async function finishSync(
  db: SupabaseClient,
  claim: Claim,
  nextCursor: number,
  fetchedRows: number,
  writtenRows: number,
  isFinal: boolean,
): Promise<void> {
  const { error } = await db.rpc("finish_inventory_sync", {
    p_run_id: claim.run_id,
    p_next_cursor: nextCursor,
    p_fetched_rows: fetchedRows,
    p_written_rows: writtenRows,
    p_is_final: isFinal,
  });
  if (error) throw error;
}

export async function failSync(db: SupabaseClient, claim: Claim, error: unknown): Promise<void> {
  if (!claim.run_id) return;
  const value = error instanceof Error ? error : new Error(String(error));
  await db.rpc("fail_inventory_sync", {
    p_run_id: claim.run_id,
    p_error_code: String((value as Error & { code?: string }).code ?? "SYNC_FAILED"),
    p_error_message: value.message,
  });
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
  attempts = 2,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`Upstream HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        (error as Error & { code?: string }).code = `HTTP_${response.status}`;
        if (![408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(response.status)) throw error;
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  throw lastError instanceof Error ? lastError : new Error("Upstream request failed");
}

export function clean(value: unknown): string {
  return String(value ?? "").trim();
}
