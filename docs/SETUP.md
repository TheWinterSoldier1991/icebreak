# IceBreak setup guide

Firebase project: `icebreak-wts1991-20261027`  
Vercel project: `icebreak`  
Firebase Functions region in this codebase: `us-west1`

## 1. Firebase project and Firestore

The Firebase project has been created. Before creating Firestore, choose a database location in the Firebase Console. Location is difficult or impossible to change later. `us-west1` is a reasonable latency choice for a California-based owner, but select the region that fits your users and any data-residency requirements.

1. Open the [IceBreak Firebase Console](https://console.firebase.google.com/project/icebreak-wts1991-20261027/overview).
2. Open **Firestore Database** and create the default database using the **Standard** edition and the location you selected.
3. Deploy the rules and functions from this repository:

   ```sh
   npx -y firebase-tools@latest login
   npx -y firebase-tools@latest use icebreak-wts1991-20261027
   npx -y firebase-tools@latest deploy --only firestore:rules,functions
   ```

The app's Firestore rules allow a signed-in user to read only their own profile and budget collections. Direct client writes and all client access to Plaid token documents are denied. Cloud Functions use the Admin SDK for validated writes.

## 2. Firebase Authentication and Web App

1. In Firebase Console, open **Authentication → Get started → Sign-in method** and enable **Email/Password**.
2. Under Authentication settings, add the deployed Vercel domain to **Authorized domains**.
3. Create or select a Firebase **Web App** named `IceBreak Web` in Project settings.
4. Copy its Firebase Web configuration values into `.env.local` for local development and into Vercel Project → **Settings → Environment Variables** for Preview and Production:

   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION=us-west1`
   - `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false`

These values identify the browser app and are not service-account credentials. Never add a service-account JSON key to the Next.js app or GitHub.

### Multi-factor authentication

The specifications call for two-step sign-in. Firebase SMS MFA requires upgrading Authentication to Identity Platform, enabling the SMS second factor, setting allowed SMS regions, and verifying email addresses. The current app implements email/password auth and session expiry, but does **not** yet include the phone enrollment or MFA challenge screens. Do not enable mandatory MFA until those screens have been implemented and verified; otherwise users with an enrolled second factor may be unable to sign in.

Firebase Authentication has its own abuse protection. The requested custom lockout after five failed attempts is also not implemented as a server-enforced policy in this prototype and must be designed before production.

## 3. Plaid Sandbox (steps for the project owner)

1. Create a Plaid account and a new **Sandbox** application in the [Plaid Dashboard](https://dashboard.plaid.com/).
2. Enable the **Transactions** product for the app.
3. Copy the Sandbox **client ID** and **secret** from the Dashboard. Keep them private.
4. From a terminal, set the values as Firebase Functions secrets. The CLI prompts for each value; enter it directly there, not in chat, a source file, or Vercel:

   ```sh
   npx -y firebase-tools@latest functions:secrets:set PLAID_CLIENT_ID --project icebreak-wts1991-20261027
   npx -y firebase-tools@latest functions:secrets:set PLAID_SECRET --project icebreak-wts1991-20261027
   ```

5. Deploy Functions so the secret-backed Plaid endpoints are available:

   ```sh
   npx -y firebase-tools@latest deploy --only functions --project icebreak-wts1991-20261027
   ```

6. Sign in to IceBreak, choose **Connect bank**, and use Plaid's Sandbox institution/test credentials. On a successful Link flow, the server exchanges the short-lived public token, stores the access token in the private Firestore path, and syncs transactions. Use **Settings → Bank connected · sync** to fetch new activity later.

The integration defaults to Plaid Sandbox. Do not use live financial accounts until you have completed Plaid's production review and changed the server-side Plaid environment deliberately. Never place `PLAID_SECRET` in Vercel or any `NEXT_PUBLIC_` variable.

## 4. Vercel deployment

The GitHub repository is linked to the Vercel project `icebreak`; `main` is the production branch. After adding the Firebase Web App variables above, trigger a new deployment in Vercel or push a follow-up commit. Configure those same public Firebase values for Preview if you want preview URLs to support sign-in. Keep all Plaid secrets only in Firebase Functions.

## 5. Local emulators

Run the Auth, Firestore, and Functions emulators in one terminal:

```sh
npx -y firebase-tools@latest emulators:start --project icebreak-wts1991-20261027
```

Set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` in `.env.local` for the Next.js app, then restart `npm run dev`. Emulator mode uses local Auth/Firestore/Functions and does not connect to Plaid.

## Current prototype limits

- The dashboard chart is sample visualization, not a historical analytics query.
- Imported Plaid transactions are deduplicated and added on sync; this prototype does not yet reconcile modified/removed transactions or process Plaid webhooks.
- SMS MFA enrollment/challenge and the five-attempt lockout remain to implement before production use.
