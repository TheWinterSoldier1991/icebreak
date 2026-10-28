# IcebreaK

IcebreaK is a student budgeting app built with Next.js and hosted on Vercel. Supabase provides account sign-in, the Postgres database, row-level security, and live budget updates.

## What it does

- Email and password accounts with a private profile and starter budget categories.
- Track income and expenses, allocate income across spending and savings categories, and view remaining balances.
- Create savings goals and record contributions.
- Receive live updates to budget data.
- Switch between light and dark themes.
- Optionally connect a bank through Plaid. Plaid requires credentials and a deployed Supabase Edge Function; see [the setup guide](docs/SETUP.md).

## Run locally

1. Use Node.js 22 or later.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key.
3. Run `npm install`, then `npm run dev`.
4. Open `http://localhost:3000`.

Without Supabase environment values, the site runs in demo mode; demo changes stay in memory and are not saved.

## Supabase and deployment

The live project is **Project IcebreaK** (`bylkppsxkoekbnhwgwnk`). Its database migration is in `supabase/migrations/`; email sign-in and redirect URL setup are described in [docs/SETUP.md](docs/SETUP.md). Budget records are protected by row-level security, and budget writes use validated database functions.

The Vercel project is `icebreak`, with production at [icebreak-ten.vercel.app](https://icebreak-ten.vercel.app). Vercel receives the public Supabase URL and publishable key through its environment settings. Merging to `main` triggers deployment. Plaid secrets belong in Supabase Edge Function secrets, never in source control or browser-visible variables.
