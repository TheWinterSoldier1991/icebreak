# Supabase setup

IcebreaK uses the Supabase project **Project IcebreaK** (`bylkppsxkoekbnhwgwnk`) for user accounts and saved budgets. The Vercel project already has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` configured for Production, Preview, and Development.

## 1. Apply the database migration

From the project folder, run:

```powershell
npx supabase@latest login
npx supabase@latest link --project-ref bylkppsxkoekbnhwgwnk
npx supabase@latest db push
```

The migration `supabase/migrations/20261028024906_icebreak_supabase_backend.sql` creates the profile, category, transaction, goal, and private Plaid-token tables, owner-only read policies, signup defaults, and validated budget-write functions. Realtime is enabled for the budget tables when the project has the standard `supabase_realtime` publication. It has already been applied to **Project IcebreaK**; `db push` will see its version as applied.

For a fresh Supabase project, run the commands above to apply the migration.

## 2. Enable email and password sign-in

1. Open the [IceBreak Supabase dashboard](https://supabase.com/dashboard/project/bylkppsxkoekbnhwgwnk).
2. Go to **Authentication → Sign In / Providers → Email**.
3. Enable the Email provider and save.
4. In **Authentication → URL Configuration**, set the Site URL to `https://icebreak-ten.vercel.app`.
5. Add these redirect URLs:
   - `https://icebreak-ten.vercel.app/**`
   - `http://localhost:3000/**`
   - Your Vercel preview URL pattern if you plan to test sign-up from preview deployments.

If email confirmations are enabled, new users must click the verification link before signing in. The database trigger creates the profile and six starter categories when Supabase creates the user record.

## 3. Run locally

Copy `.env.example` to `.env.local`, then set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://bylkppsxkoekbnhwgwnk.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Find the publishable key under **Project Settings → API Keys**. Never use a Supabase secret/service-role key in either `NEXT_PUBLIC_` variable. Then run `npm install` and `npm run dev`.

## 4. Configure Plaid (optional)

Plaid Link runs in the browser, while the Plaid secret and access tokens stay in Supabase. In the Plaid dashboard, create or use a Sandbox app and copy its client ID and Sandbox secret. Add them as Supabase Edge Function secrets using the Supabase dashboard’s Edge Function secrets page, or enter them directly in a terminal:

```powershell
npx supabase@latest secrets set PLAID_CLIENT_ID=YOUR_CLIENT_ID PLAID_SECRET=YOUR_SANDBOX_SECRET PLAID_ENV=sandbox --project-ref bylkppsxkoekbnhwgwnk
npx supabase@latest functions deploy plaid --project-ref bylkppsxkoekbnhwgwnk
```

Use the values only in the terminal prompt/command or Supabase dashboard. Do not paste them into chat, GitHub, `.env.local`, Vercel, or source code. When ready for live connections, switch to Plaid production credentials and set `PLAID_ENV=production`.

The function exchanges the short-lived public token, stores the access token in the service-role-only `plaid_items` table, creates Link tokens, and syncs newly added transactions. The Edge Function validates the Supabase user token before each action.

## 5. Deploy

The Vercel project already has the project URL and publishable key in all three environments. A push or merge to `main` triggers the connected GitHub deployment. If Vercel reports missing values, open **Vercel → icebreak → Settings → Environment Variables** and make sure these are enabled for Production, Preview, and Development:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

After changing environment variables, redeploy so the deployment receives them.
