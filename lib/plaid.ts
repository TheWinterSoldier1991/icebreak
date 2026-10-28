import { createClient } from "@/lib/supabase/client";

export type PlaidAction = "status" | "create_link_token" | "exchange_public_token" | "sync_transactions";

export async function callPlaid<TOutput>(action: PlaidAction, payload: Record<string, unknown> = {}): Promise<TOutput> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase is not configured yet.");
  const { data, error } = await supabase.functions.invoke("plaid", { body: { action, ...payload } });
  if (error) throw error;
  return data as TOutput;
}
