const crypto = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require("plaid");

initializeApp();
setGlobalOptions({ region: "us-west1", maxInstances: 10 });

const db = getFirestore();
const plaidClientId = defineSecret("PLAID_CLIENT_ID");
const plaidSecret = defineSecret("PLAID_SECRET");
const palette = ["#537f72", "#d89954", "#7397a0", "#9d8bbc", "#d17f78", "#739677"];
const starterCategories = [
  { name: "Rent & bills", icon: "⌂", targetPercent: 35, kind: "spending" },
  { name: "Food & groceries", icon: "✳", targetPercent: 20, kind: "spending" },
  { name: "Transport", icon: "↗", targetPercent: 10, kind: "spending" },
  { name: "Books & school", icon: "▤", targetPercent: 10, kind: "spending" },
  { name: "Savings", icon: "✿", targetPercent: 15, kind: "savings" },
  { name: "Just for fun", icon: "☼", targetPercent: 10, kind: "spending" },
];

function requireUser(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to use your budget.");
  return request.auth.uid;
}

function stringField(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpsError("invalid-argument", `${field} is required and must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
}

function centsField(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000_000_00) {
    throw new HttpsError("invalid-argument", "Amount must be a positive whole-cent value.");
  }
  return value;
}

function userRef(uid) { return db.collection("users").doc(uid); }
function categoriesRef(uid) { return userRef(uid).collection("categories"); }
function transactionsRef(uid) { return userRef(uid).collection("transactions"); }
function goalsRef(uid) { return userRef(uid).collection("goals"); }

function allocateDeposit(amountCents, categories) {
  const totalPercent = categories.reduce((sum, item) => sum + item.targetPercent, 0);
  if (totalPercent > 100 || categories.some((item) => !Number.isFinite(item.targetPercent) || item.targetPercent < 0)) {
    throw new HttpsError("failed-precondition", "Category percentages must total 100% or less.");
  }
  const raw = categories.map((item) => amountCents * item.targetPercent / 100);
  const shares = raw.map(Math.floor);
  const allocatedTarget = Math.floor(amountCents * totalPercent / 100);
  let pennies = allocatedTarget - shares.reduce((sum, amount) => sum + amount, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - shares[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < pennies; i += 1) shares[order[i % order.length].index] += 1;
  return {
    shares,
    unallocatedCents: amountCents - shares.reduce((sum, amount) => sum + amount, 0),
  };
}

function makePlaidClient() {
  const environment = process.env.PLAID_ENV === "production" ? PlaidEnvironments.production : PlaidEnvironments.sandbox;
  return new PlaidApi(new Configuration({ basePath: environment, baseOptions: { headers: {
    "PLAID-CLIENT-ID": plaidClientId.value(),
    "PLAID-SECRET": plaidSecret.value(),
  } } }));
}

exports.bootstrapUser = onCall(async (request) => {
  const uid = requireUser(request);
  const profile = userRef(uid);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(profile);
    if (snapshot.exists) return;
    const categoryDocs = starterCategories.map((category) => ({ ...category, ref: categoriesRef(uid).doc() }));
    transaction.create(profile, {
      email: request.auth.token.email || null,
      displayName: request.auth.token.name || null,
      unallocatedCents: 0,
      createdAt: FieldValue.serverTimestamp(),
      schemaVersion: 1,
    });
    categoryDocs.forEach(({ ref, ...category }, index) => transaction.create(ref, {
      ...category, color: palette[index % palette.length], spentCents: 0, balanceCents: 0,
      createdAt: FieldValue.serverTimestamp(),
    }));
  });
  return { ok: true };
});

exports.createTransaction = onCall(async (request) => {
  const uid = requireUser(request);
  const amountCents = centsField(request.data?.amountCents);
  const type = request.data?.type;
  if (type !== "income" && type !== "expense") throw new HttpsError("invalid-argument", "Transaction type is invalid.");
  const description = stringField(request.data?.description, "Description", 80);
  const categoryId = type === "income" ? "available" : stringField(request.data?.categoryId, "Category", 128);
  const user = userRef(uid);
  const categoryCollection = categoriesRef(uid);
  const transactionDoc = transactionsRef(uid).doc();

  await db.runTransaction(async (transaction) => {
    const [profileSnap, categorySnapshot] = await Promise.all([
      transaction.get(user),
      type === "income" ? transaction.get(categoryCollection) : Promise.resolve(null),
    ]);
    if (!profileSnap.exists) throw new HttpsError("failed-precondition", "Budget profile is missing.");
    if (type === "income") {
      const categories = categorySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const allocation = allocateDeposit(amountCents, categories);
      categorySnapshot.docs.forEach((doc, index) => {
        if (allocation.shares[index] > 0) transaction.update(doc.ref, { balanceCents: (doc.data().balanceCents || 0) + allocation.shares[index] });
      });
      transaction.update(user, { unallocatedCents: (profileSnap.data().unallocatedCents || 0) + allocation.unallocatedCents });
    } else if (categoryId === "available") {
      const available = profileSnap.data().unallocatedCents || 0;
      if (amountCents > available) throw new HttpsError("failed-precondition", "That exceeds your Safe to Spend balance.");
      transaction.update(user, { unallocatedCents: available - amountCents });
    } else {
      const ref = categoriesRef(uid).doc(categoryId);
      const categorySnap = await transaction.get(ref);
      if (!categorySnap.exists) throw new HttpsError("not-found", "Choose one of your categories.");
      const current = categorySnap.data().balanceCents || 0;
      if (amountCents > current) throw new HttpsError("failed-precondition", "That exceeds this category's remaining balance.");
      transaction.update(ref, { balanceCents: current - amountCents, spentCents: (categorySnap.data().spentCents || 0) + amountCents });
    }
    transaction.create(transactionDoc, {
      description, categoryId, amountCents, type, source: "manual", createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { id: transactionDoc.id };
});

exports.createCategory = onCall(async (request) => {
  const uid = requireUser(request);
  const name = stringField(request.data?.name, "Category name", 40);
  const targetPercent = request.data?.targetPercent;
  const kind = request.data?.kind;
  if (!Number.isFinite(targetPercent) || targetPercent < 0 || targetPercent > 100) throw new HttpsError("invalid-argument", "Percentage must be between 0 and 100.");
  if (kind !== "spending" && kind !== "savings") throw new HttpsError("invalid-argument", "Category type is invalid.");
  const collection = categoriesRef(uid);
  const ref = collection.doc();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(collection);
    const currentTotal = snapshot.docs.reduce((sum, doc) => sum + (doc.data().targetPercent || 0), 0);
    if (currentTotal + targetPercent > 100) throw new HttpsError("failed-precondition", "Category percentages cannot exceed 100%.");
    transaction.create(ref, { name, icon: "◦", color: palette[snapshot.size % palette.length], targetPercent, kind, spentCents: 0, balanceCents: 0, createdAt: FieldValue.serverTimestamp() });
  });
  return { id: ref.id };
});

exports.createGoal = onCall(async (request) => {
  const uid = requireUser(request);
  const name = stringField(request.data?.name, "Goal name", 50);
  const targetCents = centsField(request.data?.targetCents);
  const due = typeof request.data?.due === "string" ? request.data.due.trim().slice(0, 24) : "";
  const ref = goalsRef(uid).doc();
  await ref.create({ name, targetCents, savedCents: 0, due: due || "No date", createdAt: FieldValue.serverTimestamp() });
  return { id: ref.id };
});

exports.contributeToGoal = onCall(async (request) => {
  const uid = requireUser(request);
  const goalId = stringField(request.data?.goalId, "Goal", 128);
  const amountCents = centsField(request.data?.amountCents);
  const goalRef = goalsRef(uid).doc(goalId);
  const user = userRef(uid);
  const savingsQuery = await categoriesRef(uid).where("kind", "==", "savings").get();
  await db.runTransaction(async (transaction) => {
    const [profileSnap, goalSnap] = await Promise.all([transaction.get(user), transaction.get(goalRef)]);
    if (!profileSnap.exists || !goalSnap.exists) throw new HttpsError("not-found", "Goal or budget profile was not found.");
    const savings = await Promise.all(savingsQuery.docs.map((doc) => transaction.get(doc.ref)));
    const sourceIndex = savings.findIndex((snap) => snap.exists && (snap.data().balanceCents || 0) >= amountCents);
    if (sourceIndex >= 0) {
      transaction.update(savingsQuery.docs[sourceIndex].ref, { balanceCents: savings[sourceIndex].data().balanceCents - amountCents });
    } else {
      const unallocated = profileSnap.data().unallocatedCents || 0;
      if (amountCents > unallocated) throw new HttpsError("failed-precondition", "There is not enough Safe to Spend or savings balance for this contribution.");
      transaction.update(user, { unallocatedCents: unallocated - amountCents });
    }
    transaction.update(goalRef, { savedCents: (goalSnap.data().savedCents || 0) + amountCents, updatedAt: FieldValue.serverTimestamp() });
  });
  return { contributed: true };
});

exports.createLinkToken = onCall({ secrets: [plaidClientId, plaidSecret] }, async (request) => {
  const uid = requireUser(request);
  const client = makePlaidClient();
  const response = await client.linkTokenCreate({
    user: { client_user_id: uid }, client_name: "IceBreak", products: [Products.Transactions],
    country_codes: [CountryCode.Us], language: "en",
  });
  return { linkToken: response.data.link_token };
});

exports.getBankStatus = onCall(async (request) => {
  const uid = requireUser(request);
  const snapshot = await userRef(uid).collection("private").doc("plaid").get();
  return { connected: snapshot.exists, lastSyncAt: snapshot.data()?.lastSyncAt?.toDate?.().toISOString() || null };
});

exports.exchangePlaidPublicToken = onCall({ secrets: [plaidClientId, plaidSecret] }, async (request) => {
  const uid = requireUser(request);
  const publicToken = stringField(request.data?.publicToken, "Plaid public token", 4096);
  const response = await makePlaidClient().itemPublicTokenExchange({ public_token: publicToken });
  await userRef(uid).collection("private").doc("plaid").set({
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
    cursor: null,
    connectedAt: FieldValue.serverTimestamp(),
  });
  return { connected: true };
});

exports.syncTransactions = onCall({ secrets: [plaidClientId, plaidSecret] }, async (request) => {
  const uid = requireUser(request);
  const plaidRef = userRef(uid).collection("private").doc("plaid");
  const plaidSnapshot = await plaidRef.get();
  if (!plaidSnapshot.exists) throw new HttpsError("failed-precondition", "Connect a bank before syncing transactions.");
  const client = makePlaidClient();
  let cursor = plaidSnapshot.data().cursor || undefined;
  const added = [];
  let hasMore = true;
  while (hasMore && added.length < 500) {
    const response = await client.transactionsSync({ access_token: plaidSnapshot.data().accessToken, cursor, count: 100 });
    added.push(...response.data.added);
    cursor = response.data.next_cursor;
    hasMore = response.data.has_more;
  }
  const categories = await categoriesRef(uid).get();
  const byPlaidId = new Map(categories.docs.map((doc) => [doc.data().name.toLowerCase(), doc.id]));
  const user = userRef(uid);
  for (const plaidTransaction of added) {
    const id = crypto.createHash("sha256").update(plaidTransaction.transaction_id).digest("hex");
    const target = transactionsRef(uid).doc(id);
    const cents = Math.round(Math.abs(plaidTransaction.amount) * 100);
    if (!cents) continue;
    const type = plaidTransaction.amount < 0 ? "income" : "expense";
    const normalizedCategory = (plaidTransaction.personal_finance_category?.primary || "").replaceAll("_", " ").toLowerCase();
    const categoryId = type === "income" ? "available" : [...byPlaidId.entries()].find(([name]) => normalizedCategory.includes(name.toLowerCase()))?.[1] || "available";
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(target);
      if (existing.exists) return;
      const profileSnap = await transaction.get(user);
      if (!profileSnap.exists) return;
      if (type === "income") {
        const categorySnapshots = await Promise.all(categories.docs.map((doc) => transaction.get(doc.ref)));
        const liveCategories = categorySnapshots.map((snap, index) => ({ id: snap.id, ...snap.data(), ref: categories.docs[index].ref }));
        const allocation = allocateDeposit(cents, liveCategories);
        liveCategories.forEach((category, index) => {
          if (allocation.shares[index] > 0) transaction.update(category.ref, { balanceCents: (category.balanceCents || 0) + allocation.shares[index] });
        });
        transaction.update(user, { unallocatedCents: (profileSnap.data().unallocatedCents || 0) + allocation.unallocatedCents });
      } else if (categoryId === "available") {
        transaction.update(user, { unallocatedCents: (profileSnap.data().unallocatedCents || 0) - cents });
      } else {
        const ref = categoriesRef(uid).doc(categoryId);
        const snap = await transaction.get(ref);
        if (snap.exists) transaction.update(ref, { balanceCents: (snap.data().balanceCents || 0) - cents, spentCents: (snap.data().spentCents || 0) + cents });
      }
      transaction.create(target, {
        description: plaidTransaction.merchant_name || plaidTransaction.name || "Bank transaction",
        categoryId, amountCents: cents, type, source: "plaid", plaidTransactionId: plaidTransaction.transaction_id,
        pending: Boolean(plaidTransaction.pending), createdAt: plaidTransaction.date ? new Date(`${plaidTransaction.date}T12:00:00Z`) : FieldValue.serverTimestamp(),
      });
    });
  }
  await plaidRef.update({ cursor: cursor || null, lastSyncAt: FieldValue.serverTimestamp() });
  return { imported: added.length, hasMore };
});
