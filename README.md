# IceBreak

IceBreak is a flexible budgeting app for college students with irregular income. It assigns deposits to user-defined category percentages, tracks spending and savings goals, and shows what remains safe to spend.

## Stack

- Next.js App Router on Vercel
- Firebase Authentication and Cloud Firestore
- Firebase Cloud Functions for budget writes and Plaid calls
- Plaid Link and Transactions (Sandbox first)

## Local development

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env.local` and fill the Firebase Web App configuration.
3. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

Without Firebase configuration, the app stays in sample-data demo mode. Demo changes are in memory and disappear on refresh.

## Firebase and Plaid setup

The Firebase project is `icebreak-wts1991-20261027`. Its Standard Firestore database is in `us-west1`, the owner-only rules are deployed, and the Firebase Web App is registered. Use [docs/SETUP.md](docs/SETUP.md) to enable Email/Password sign-in, finish Cloud Functions and Plaid Sandbox setup, and connect GitHub deployments.

Plaid client credentials belong only in Firebase Functions secrets. Never put a Plaid secret or Firebase service-account key in browser code, GitHub, or a `NEXT_PUBLIC_` variable.

## Data and security

- User budget data is stored under `users/{uid}` and owner-scoped subcollections.
- Firestore client writes are denied. Authenticated Cloud Functions validate and atomically apply budget changes.
- Plaid access tokens are stored in a server-only document inaccessible to client SDKs.
- Web sessions use tab-scoped Firebase persistence and sign out after 30 minutes of inactivity.
- SMS MFA and the product-spec five-failed-login lockout still require account-side configuration and a dedicated enrollment/challenge flow before production use.

## Deploy

The current production build is deployed at [icebreak-ten.vercel.app](https://icebreak-ten.vercel.app), with Firebase Web App values already set in Vercel. The Vercel GitHub App is not yet connected, so pushes to `main` do not automatically deploy. Connect the `TheWinterSoldier1991/icebreak` repository in Vercel Project Settings → Git to enable that workflow. Vercel SSO protection is enabled for the default `.vercel.app` domain. Cloud Functions deployment is pending Firebase's Blaze billing requirement; do not put Plaid credentials in Vercel or GitHub.
