# IceBreak setup guide

Firebase project: `icebreak-wts1991-20261027`  
Vercel project: `icebreak`  
Firebase Functions region in this codebase: `us-west1`

## 1. Firebase project and Firestore

The Firebase project and default Standard Firestore database have been created in `us-west1`. Database location is difficult or impossible to change later; this region was selected for this project.

1. Open the [IceBreak Firebase Console](https://console.firebase.google.com/project/icebreak-wts1991-20261027/overview).
2. The default database and owner-only rules are already provisioned. To redeploy the rules from this repository:

   ```sh
   npx -y firebase-tools@latest login
   npx -y firebase-tools@latest use icebreak-wts1991-20261027
   npx -y firebase-tools@latest deploy --only firestore:rules --project icebreak-wts1991-20261027
   ```

The app's Firestore rules allow a signed-in user to read only their own profile and budget collections. Direct client writes and all client access to Plaid token documents are denied. Cloud Functions use the Admin SDK for validated writes. Functions have not yet been deployed: Firebase CLI reported that the project must be upgraded to the Blaze plan before Google will enable Cloud Build. No billing-plan change was made. After the owner approves that billing change, core budget functions can be deployed with:

   ```sh
   npx -y firebase-tools@latest deploy --only functions:bootstrapUser,functions:createTransaction,functions:createCategory,functions:createGoal,functions:contributeToGoal --project icebreak-wts1991-20261027
   ```

## 2. Firebase Authentication and Web App

1. In Firebase Console, open **Authentication → Get started → Sign-in method** and enable **Email/Password**.
2. Under Authentication settings, add the deployed Vercel domain to **Authorized domains**.
3. The Firebase **Web App** named `IceBreak Web` is already registered. Its public client configuration is already set in Vercel for Production, Preview, and Development. For local development, copy the Firebase Web values into `.env.local`:

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

5. After upgrading the project to Blaze, deploy Functions so the secret-backed Plaid endpoints are available:

   ```sh
   npx -y firebase-tools@latest deploy --only functions --project icebreak-wts1991-20261027
   ```

6. Sign in to IceBreak, choose **Connect bank**, and use Plaid's Sandbox institution/test credentials. On a successful Link flow, the server exchanges the short-lived public token, stores the access token in the private Firestore path, and syncs transactions. Use **Settings → Bank connected · sync** to fetch new activity later.

The integration defaults to Plaid Sandbox. Do not use live financial accounts until you have completed Plaid's production review and changed the server-side Plaid environment deliberately. Never place `PLAID_SECRET` in Vercel or any `NEXT_PUBLIC_` variable.

## 4. Vercel deployment

The project `icebreak` has a READY production deployment at [icebreak-ten.vercel.app](https://icebreak-ten.vercel.app). It was deployed directly from commit `3249d9a`; Firebase Web App values are already present in Vercel. Vercel reported that its GitHub App must be installed before the repository can be linked. To enable automatic deployments, install/authorize the Vercel GitHub App for `TheWinterSoldier1991/icebreak`, then connect that repository in the project's **Settings → Git** page. The default `.vercel.app` domains have Vercel SSO protection enabled. Keep all Plaid secrets only in Firebase Functions.

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
