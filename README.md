# IcebreaK

IcebreaK is a student budgeting app hosted on Vercel. Supabase provides email/password authentication, Postgres storage, row-level security, realtime budget updates, and the server-side Edge Function used for Plaid.

## Local setup

1. Install Node.js 22 or later.
2. Copy `.env.example` to `.env.local` and add the Supabase publishable key from the IceBreak project.
3. Install dependencies with `npm install`.
4. Run `npm run dev` and open `http://localhost:3000`.

Without Supabase environment values, the site runs in demo mode. Demo changes stay in memory and are not saved.

## Supabase setup

The Supabase project reference is `bylkppsxkoekbnhwgwnk`. Apply the database migration, enable Email sign-in, configure redirect URLs, and optionally add Plaid secrets by following [docs/SETUP.md](docs/SETUP.md).

New Supabase users receive a private profile and starter budget categories from a database trigger. Budget data is readable only by its owner. Financial writes go through validated Postgres functions; the browser never receives the Supabase service-role key or Plaid access tokens.

## Deployment

The Vercel project is `icebreak` and the production site is [icebreak-ten.vercel.app](https://icebreak-ten.vercel.app). Vercel’s GitHub integration is connected to `TheWinterSoldier1991/icebreak`. The Supabase project URL and publishable key are configured for Production, Preview, and Development. Merging a change to `main` starts a Vercel deployment.

Vercel SSO protection is enabled on the default deployment domains. For Plaid, set `PLAID_CLIENT_ID`, `PLAID_SECRET`, and `PLAID_ENV` as Supabase Edge Function secrets, then deploy the `plaid` function. Do not put these values in GitHub, source files, or `NEXT_PUBLIC_` variables.

## Data migration note

This code switches new sign-ups and budget data to Supabase. Existing Firebase accounts and data are not copied automatically; users with an old Firebase account need to create a Supabase account. Firebase credentials are not part of this repository.
