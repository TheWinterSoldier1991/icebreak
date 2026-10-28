import { createClient } from "npm:@supabase/supabase-js@2";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "npm:plaid@35.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function makePlaidClient() {
  const clientId = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SECRET");
  if (!clientId || !secret) throw new Error("Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to Supabase Edge Function secrets.");
  const environment = Deno.env.get("PLAID_ENV") === "production" ? PlaidEnvironments.production : PlaidEnvironments.sandbox;
  return new PlaidApi(new Configuration({
    basePath: environment,
    baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
  }));
}

function normalize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replaceAll("&", "and").trim();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });

  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !publishableKey || !serviceRoleKey) return reply(500, { error: "Supabase function configuration is incomplete." });
  if (!authorization) return reply(401, { error: "Sign in before using bank connection." });

  const authClient = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return reply(401, { error: "Your session is invalid or expired. Sign in again." });

  let body: { action?: string; publicToken?: string };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "Request body must be valid JSON." });
  }

  const action = body.action;
  if (!action || !["status", "create_link_token", "exchange_public_token", "sync_transactions"].includes(action)) {
    return reply(400, { error: "Unsupported bank connection action." });
  }

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    if (action === "status") {
      const { data, error } = await admin.from("plaid_items").select("last_sync_at").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      return reply(200, { connected: Boolean(data), lastSyncAt: data?.last_sync_at ?? null });
    }

    const plaid = makePlaidClient();
    if (action === "create_link_token") {
      const result = await plaid.linkTokenCreate({
        user: { client_user_id: user.id },
        client_name: "IceBreak",
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: "en",
      });
      return reply(200, { linkToken: result.data.link_token });
    }

    if (action === "exchange_public_token") {
      if (typeof body.publicToken !== "string" || !body.publicToken.trim() || body.publicToken.length > 4096) {
        return reply(400, { error: "A valid Plaid public token is required." });
      }
      const result = await plaid.itemPublicTokenExchange({ public_token: body.publicToken.trim() });
      const { error } = await admin.from("plaid_items").upsert({
        user_id: user.id,
        access_token: result.data.access_token,
        item_id: result.data.item_id,
        cursor: null,
        connected_at: new Date().toISOString(),
        last_sync_at: null,
      }, { onConflict: "user_id" });
      if (error) throw error;
      return reply(200, { connected: true });
    }

    const { data: item, error: itemError } = await admin
      .from("plaid_items")
      .select("access_token, cursor")
      .eq("user_id", user.id)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) return reply(409, { error: "Connect a bank before syncing transactions." });

    const { data: categories, error: categoriesError } = await admin
      .from("categories")
      .select("id, name")
      .eq("user_id", user.id);
    if (categoriesError) throw categoriesError;

    let cursor: string | undefined = item.cursor ?? undefined;
    let hasMore = true;
    let imported = 0;
    let pages = 0;
    while (hasMore && pages < 5) {
      const result = await plaid.transactionsSync({ access_token: item.access_token, cursor, count: 100 });
      pages += 1;
      cursor = result.data.next_cursor;
      hasMore = result.data.has_more;

      for (const transaction of result.data.added) {
        const amountCents = Math.round(Math.abs(transaction.amount) * 100);
        if (!amountCents) continue;
        const type = transaction.amount < 0 ? "income" : "expense";
        const primary = normalize(transaction.personal_finance_category?.primary ?? "");
        const match = type === "expense"
          ? categories?.find((category) => primary.includes(normalize(category.name)))
          : undefined;
        const createdAt = transaction.datetime
          ? new Date(transaction.datetime).toISOString()
          : transaction.date
            ? new Date(`${transaction.date}T12:00:00.000Z`).toISOString()
            : new Date().toISOString();

        const { data: wasImported, error } = await admin.rpc("import_plaid_transaction", {
          p_user_id: user.id,
          p_plaid_transaction_id: transaction.transaction_id,
          p_description: transaction.merchant_name || transaction.name || "Bank transaction",
          p_amount_cents: amountCents,
          p_type: type,
          p_category_id: match?.id ?? null,
          p_pending: Boolean(transaction.pending),
          p_created_at: createdAt,
        });
        if (error) throw error;
        if (wasImported) imported += 1;
      }
    }

    const { error: cursorError } = await admin.from("plaid_items").update({
      cursor: cursor ?? null,
      last_sync_at: new Date().toISOString(),
    }).eq("user_id", user.id);
    if (cursorError) throw cursorError;
    return reply(200, { imported, hasMore });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error("Plaid Edge Function failed:", { action, errorName });
    return reply(500, { error: "Bank connection request failed. Check the Supabase Edge Function logs." });
  }
});
