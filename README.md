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

The Firebase project is `icebreak-wts1991-20261027`. Use the detailed walkthrough in [docs/SETUP.md](docs/SETUP.md) to select a Firestore location, enable Authentication, register a Web app, deploy rules and Functions, add Plaid Sandbox credentials, and configure Vercel.

Plaid client credentials belong only in Firebase Functions secrets. Never put a Plaid secret or Firebase service-account key in browser code, GitHub, or a `NEXT_PUBLIC_` variable.

## Data and security

- User budget data is stored under `users/{uid}` and owner-scoped subcollections.
- Firestore client writes are denied. Authenticated Cloud Functions validate and atomically apply budget changes.
- Plaid access tokens are stored in a server-only document inaccessible to client SDKs.
- Web sessions use tab-scoped Firebase persistence and sign out after 30 minutes of inactivity.
- SMS MFA and the product-spec five-failed-login lockout still require account-side configuration and a dedicated enrollment/challenge flow before production use.

## Deploy

The repository is linked to Vercel and `main` is the production branch. Set the `NEXT_PUBLIC_FIREBASE_*` Web App values in Vercel Project Settings, then deploy. Vercel environment variables are public browser configuration only; keep Plaid credentials in Firebase Functions secrets.
