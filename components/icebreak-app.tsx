"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { usePlaidLink } from "@/lib/use-plaid-link";
import { callBackend } from "@/lib/backend";
import { useAuth } from "@/lib/auth-context";
import { getFirebaseClient } from "@/lib/firebase";
import {
  formatMoney,
  parseMoneyToCents,
  splitDeposit,
  validateCategoryPercentages,
  type BudgetCategory,
} from "@/lib/budgeting";

type Section = "overview" | "activity" | "categories" | "goals" | "trends" | "settings";
type Transaction = {
  id: string;
  description: string;
  categoryId: string;
  amountCents: number;
  type: "income" | "expense";
  date: Date;
  pending?: boolean;
};
type Goal = { id: string; name: string; targetCents: number; savedCents: number; due: string };
type Modal = "transaction" | "goal" | "contribution" | "category" | "connect" | "signin" | null;

const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const initialCategories: BudgetCategory[] = [
  { id: "rent", name: "Rent & bills", icon: "⌂", color: "#537f72", targetPercent: 35, targetCents: 125000, spentCents: 84640, balanceCents: 40360, kind: "spending" },
  { id: "food", name: "Food & groceries", icon: "✳", color: "#d89954", targetPercent: 20, targetCents: 72000, spentCents: 43270, balanceCents: 28730, kind: "spending" },
  { id: "transport", name: "Transport", icon: "↗", color: "#7397a0", targetPercent: 10, targetCents: 36000, spentCents: 12800, balanceCents: 23200, kind: "spending" },
  { id: "books", name: "Books & school", icon: "▤", color: "#9d8bbc", targetPercent: 10, targetCents: 36000, spentCents: 17450, balanceCents: 18550, kind: "spending" },
  { id: "savings", name: "Savings", icon: "✿", color: "#739677", targetPercent: 15, targetCents: 54000, spentCents: 0, balanceCents: 54000, kind: "savings" },
  { id: "fun", name: "Just for fun", icon: "☼", color: "#d17f78", targetPercent: 10, targetCents: 36000, spentCents: 21800, balanceCents: 14200, kind: "spending" },
];

const initialTransactions: Transaction[] = [
  { id: "tx-1", description: "Campus bookstore", categoryId: "books", amountCents: 4899, type: "expense", date: new Date() },
  { id: "tx-2", description: "Grocery run", categoryId: "food", amountCents: 7246, type: "expense", date: new Date() },
  { id: "tx-3", description: "Part-time paycheck", categoryId: "available", amountCents: 125000, type: "income", date: new Date(Date.now() - 86400000) },
  { id: "tx-4", description: "Monthly rent", categoryId: "rent", amountCents: 82500, type: "expense", date: new Date(Date.now() - 2 * 86400000) },
  { id: "tx-5", description: "Bus pass", categoryId: "transport", amountCents: 2800, type: "expense", date: new Date(Date.now() - 3 * 86400000) },
  { id: "tx-6", description: "Coffee with Maya", categoryId: "fun", amountCents: 890, type: "expense", date: new Date(Date.now() - 4 * 86400000) },
];

const initialGoals: Goal[] = [
  { id: "goal-1", name: "Spring break", targetCents: 120000, savedCents: 73500, due: "Mar 2027" },
  { id: "goal-2", name: "Emergency cushion", targetCents: 200000, savedCents: 82000, due: "May 2027" },
];

const navItems: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "▦" },
  { id: "activity", label: "Activity", icon: "↕" },
  { id: "categories", label: "Categories", icon: "◷" },
  { id: "goals", label: "Savings goals", icon: "◎" },
  { id: "trends", label: "Your trends", icon: "⌁" },
];

const sectionTitles: Record<Section, { title: string; subtitle: string }> = {
  overview: { title: "Your money, in a good place.", subtitle: "A clear view of what came in, what’s planned, and what’s yours to spend." },
  activity: { title: "Every little move.", subtitle: "Keep an eye on the money coming in and going out." },
  categories: { title: "Give every dollar a home.", subtitle: "Your percentages add up to 100% or less. Anything left stays safe to spend." },
  goals: { title: "Little by little adds up.", subtitle: "Make room for the things you’re looking forward to." },
  trends: { title: "Your money has a rhythm.", subtitle: "A simple look at how your spending changes over time." },
  settings: { title: "Your account, your way.", subtitle: "Manage your profile, privacy, and connected accounts." },
};

function dateLabel(date: Date) {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === new Date(Date.now() - 86400000).toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function Icon({ children, className = "" }: { children: string; className?: string }) {
  return <span aria-hidden="true" className={`icon ${className}`}>{children}</span>;
}

export function IceBreakApp() {
  const { user, configured, signIn, signUp, signOutUser } = useAuth();
  const [section, setSection] = useState<Section>("overview");
  const [categories, setCategories] = useState(initialCategories);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [goals, setGoals] = useState(initialGoals);
  const [unallocatedCents, setUnallocatedCents] = useState(57840);
  const [modal, setModal] = useState<Modal>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");
  const [authBusy, setAuthBusy] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null);
  const [openPlaidAfterReady, setOpenPlaidAfterReady] = useState(false);
  const [bankConnected, setBankConnected] = useState(false);
  const [syncingBank, setSyncingBank] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    try {
      setDarkMode(window.localStorage.getItem("icebreak-theme") === "dark");
    } catch {
      // Keep the default light theme when browser storage is unavailable.
    }
  }, []);

  function toggleTheme() {
    setDarkMode((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("icebreak-theme", next ? "dark" : "light");
      } catch {
        // The theme still changes for this session when storage is unavailable.
      }
      return next;
    });
  }

  useEffect(() => {
    if (!user) return;
    const client = getFirebaseClient();
    if (!client) return;
    const profileRef = doc(client.db, "users", user.uid);
    const categoriesRef = collection(client.db, "users", user.uid, "categories");
    const transactionsRef = query(collection(client.db, "users", user.uid, "transactions"), orderBy("createdAt", "desc"), limit(200));
    const goalsRef = query(collection(client.db, "users", user.uid, "goals"), orderBy("createdAt", "desc"));
    const stopProfile = onSnapshot(profileRef, (snapshot) => {
      if (snapshot.exists()) setUnallocatedCents(snapshot.data().unallocatedCents ?? 0);
    }, () => setMessage("Couldn’t load your budget profile. Confirm Firestore is created and deployed."));
    const stopCategories = onSnapshot(categoriesRef, (snapshot) => {
      setCategories(snapshot.docs.map((item) => ({
        id: item.id,
        name: item.data().name,
        icon: item.data().icon || "◦",
        color: item.data().color || "#537f72",
        targetPercent: item.data().targetPercent || 0,
        targetCents: item.data().targetCents || 0,
        spentCents: item.data().spentCents || 0,
        balanceCents: item.data().balanceCents || 0,
        kind: item.data().kind === "savings" ? "savings" : "spending",
      })));
    }, () => setMessage("Couldn’t load categories. Check your Firestore rules."));
    const stopTransactions = onSnapshot(transactionsRef, (snapshot) => {
      setTransactions(snapshot.docs.map((item) => {
        const createdAt = item.data().createdAt;
        return {
          id: item.id,
          description: item.data().description || "Transaction",
          categoryId: item.data().categoryId || "available",
          amountCents: item.data().amountCents || 0,
          type: item.data().type === "income" ? "income" : "expense",
          date: createdAt?.toDate ? createdAt.toDate() : new Date(),
          pending: Boolean(item.data().pending),
        };
      }));
    }, () => setMessage("Couldn’t load activity. Check your Firestore rules."));
    const stopGoals = onSnapshot(goalsRef, (snapshot) => {
      setGoals(snapshot.docs.map((item) => ({
        id: item.id,
        name: item.data().name,
        targetCents: item.data().targetCents || 0,
        savedCents: item.data().savedCents || 0,
        due: item.data().due || "No date",
      })));
    }, () => setMessage("Couldn’t load goals. Check your Firestore rules."));
    void callBackend("bootstrapUser", {}).catch(() => setMessage("Your profile is not ready yet. Check Firebase Functions deployment."));
    void callBackend<{}, { connected: boolean }>("getBankStatus", {}).then((status) => setBankConnected(status.connected)).catch(() => undefined);
    return () => { stopProfile(); stopCategories(); stopTransactions(); stopGoals(); };
  }, [user]);

  const plaidHandler = usePlaidLink({
    token: plaidLinkToken,
    onSuccess: async (publicToken) => {
      try {
        await callBackend("exchangePlaidPublicToken", { publicToken });
        setBankConnected(true);
        const result = await callBackend<{}, { imported: number }>("syncTransactions", {});
        setModal(null);
        setMessage(`Bank connected. Imported ${result.imported} transactions.`);
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not finish connecting this bank.");
      }
    },
  });

  useEffect(() => {
    if (openPlaidAfterReady && plaidHandler.ready) {
      setOpenPlaidAfterReady(false);
      plaidHandler.open();
    }
  }, [openPlaidAfterReady, plaidHandler.ready, plaidHandler.open]);

  const monthTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date >= startOfMonth),
    [transactions],
  );
  const monthIncome = monthTransactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const monthSpent = monthTransactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const availableCents = unallocatedCents;
  const visibleCategories = user
    ? categories.map((category) => ({ ...category, targetCents: Math.round(monthIncome * category.targetPercent / 100) }))
    : categories;
  const plannedCents = visibleCategories.reduce((sum, category) => sum + category.targetCents, 0);
  const percentageTotal = categories.reduce((sum, category) => sum + category.targetPercent, 0);
  const activeGoal = goals[0];
  const heroTitle = sectionTitles[section];
  const profileName = user?.displayName || user?.email?.split("@")[0] || "Student account";
  const profileInitials = profileName.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "IB";

  function openModal(next: Modal) {
    setFormError("");
    setModal(next);
  }

  async function handleTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = parseMoneyToCents(String(form.get("amount") ?? ""));
    const type = String(form.get("type")) as "income" | "expense";
    const categoryId = String(form.get("categoryId") ?? "available");
    const description = String(form.get("description") ?? "").trim();
    if (!amountCents || !description) {
      setFormError("Add a valid amount and a short description.");
      return;
    }

    if (user) {
      try {
        await callBackend("createTransaction", { amountCents, description, type, categoryId });
        setModal(null);
        setMessage(type === "income" ? "Deposit split across your categories." : "Transaction added to your budget.");
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not save this transaction.");
      }
      return;
    }

    if (type === "income") {
      const result = splitDeposit(amountCents, categories);
      setCategories((current) => current.map((category) => {
        const allocation = result.allocations.find((item) => item.categoryId === category.id);
        return allocation ? { ...category, balanceCents: category.balanceCents + allocation.amountCents } : category;
      }));
      setUnallocatedCents((current) => current + result.unallocatedCents);
    } else if (categoryId === "available") {
      if (amountCents > unallocatedCents) {
        setFormError("That is more than the unallocated safe-to-spend amount.");
        return;
      }
      setUnallocatedCents((current) => current - amountCents);
    } else {
      const selected = categories.find((category) => category.id === categoryId);
      if (!selected) {
        setFormError("Choose a category for this expense.");
        return;
      }
      setCategories((current) => current.map((category) => category.id === categoryId
        ? { ...category, spentCents: category.spentCents + amountCents, balanceCents: category.balanceCents - amountCents }
        : category));
    }

    setTransactions((current) => [{
      id: crypto.randomUUID(),
      description,
      categoryId: type === "income" ? "available" : categoryId,
      amountCents,
      type,
      date: new Date(),
    }, ...current]);
    setModal(null);
    setMessage(type === "income" ? "Deposit split across your categories." : "Transaction added to your budget.");
  }

  async function handleGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const targetCents = parseMoneyToCents(String(form.get("target") ?? ""));
    if (!name || !targetCents) {
      setFormError("Enter a goal name and a target amount greater than zero.");
      return;
    }
    const date = String(form.get("due") ?? "").trim();
    if (user) {
      try {
        await callBackend("createGoal", { name, targetCents, due: date });
        setModal(null);
        setMessage("Your savings goal is ready.");
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not create this goal.");
      }
      return;
    }
    setGoals((current) => [...current, { id: crypto.randomUUID(), name, targetCents, savedCents: 0, due: date || "No date" }]);
    setModal(null);
    setMessage("Your savings goal is ready.");
  }

  async function handleContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = parseMoneyToCents(String(new FormData(event.currentTarget).get("amount") ?? ""));
    if (!amountCents) {
      setFormError("Enter a contribution greater than zero.");
      return;
    }
    const goal = goals.find((item) => item.id === selectedGoalId);
    if (!goal) {
      setFormError("Choose a savings goal first.");
      return;
    }
    if (user) {
      try {
        await callBackend("contributeToGoal", { goalId: goal.id, amountCents });
        setModal(null);
        setMessage("Your goal moved a little closer.");
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not add that contribution.");
      }
      return;
    }
    if (amountCents > unallocatedCents) {
      setFormError("That is more than your demo Safe to Spend balance.");
      return;
    }
    setUnallocatedCents((current) => current - amountCents);
    setGoals((current) => current.map((item) => item.id === goal.id ? { ...item, savedCents: item.savedCents + amountCents } : item));
    setModal(null);
    setMessage("Your goal moved a little closer.");
  }

  async function handleCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const targetPercent = Number(form.get("percentage"));
    const kind = String(form.get("kind")) as BudgetCategory["kind"];
    if (!name || !validateCategoryPercentages(categories, null, targetPercent)) {
      setFormError("Use a name and a percentage that keeps your total at 100% or less.");
      return;
    }
    if (user) {
      try {
        await callBackend("createCategory", { name, targetPercent, kind });
        setModal(null);
        setMessage("Category added. Your percentage total is still within 100%.");
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not add this category.");
      }
      return;
    }
    const id = crypto.randomUUID();
    const colors = ["#537f72", "#d89954", "#7397a0", "#9d8bbc", "#d17f78"];
    const color = colors[categories.length % colors.length];
    setCategories((current) => [...current, {
      id, name, icon: "◦", color, targetPercent,
      targetCents: Math.round(plannedCents * targetPercent / Math.max(percentageTotal, 1)),
      spentCents: 0, balanceCents: 0, kind,
    }]);
    setModal(null);
    setMessage("Category added. Your percentage total is still within 100%.");
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthBusy(true);
    setFormError("");
    try {
      if (authMode === "signup") {
        await signUp(String(form.get("name") ?? ""), String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        setMessage("Your account is ready. Check your inbox for the verification email.");
      } else {
        await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        setMessage("Welcome back.");
      }
      setModal(null);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : "Could not sign in.";
      setFormError(code === "auth/invalid-credential" ? "Email or password is incorrect." : message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleConnectBank() {
    if (!user) {
      setAuthMode("signin");
      setModal("signin");
      setFormError("Sign in before linking a bank account.");
      return;
    }
    try {
      setFormError("");
      const result = await callBackend<{}, { linkToken: string }>("createLinkToken", {});
      setPlaidLinkToken(result.linkToken);
      setOpenPlaidAfterReady(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not start Plaid Link. Check the Plaid setup guide.");
    }
  }

  async function syncBankTransactions() {
    setSyncingBank(true);
    setFormError("");
    try {
      const result = await callBackend<{}, { imported: number }>("syncTransactions", {});
      setModal(null);
      setMessage(`Bank activity synced. ${result.imported} new transactions imported.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not sync bank activity.");
    } finally {
      setSyncingBank(false);
    }
  }

  function chooseSection(next: Section) {
    setSection(next);
    setMobileNavOpen(false);
  }

  const recent = showAllTransactions ? transactions : transactions.slice(0, 5);

  return (
    <div className="app-shell" data-theme={darkMode ? "dark" : "light"}>
      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#overview" onClick={() => chooseSection("overview")}>
          <span className="brand-mark"><span>i</span></span>
          <span className="brand-name">IcebreaK<span className="brand-period">.</span></span>
        </a>
        <div className="workspace-label">YOUR SPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button key={item.id} className={`nav-item ${section === item.id ? "nav-item-active" : ""}`} onClick={() => chooseSection(item.id)} aria-current={section === item.id ? "page" : undefined}>
              <Icon>{item.icon}</Icon><span>{item.label}</span>{item.id === "activity" && <span className="nav-count">6</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">✦</span>
            <p><strong>Small steps count.</strong><br />Every plan can flex with you.</p>
          </div>
          <button className={`nav-item ${section === "settings" ? "nav-item-active" : ""}`} onClick={() => chooseSection("settings")}>
            <Icon>⚙</Icon><span>Settings</span>
          </button>
          <div className="profile-row">
            <div className="avatar">{profileInitials}</div>
            <div className="profile-copy"><strong>{profileName}</strong><span>{user ? "Your student account" : "Demo workspace"}</span></div>
            <button className="more-button" aria-label={user ? "Sign out" : "Account menu"} onClick={() => user ? void signOutUser() : chooseSection("settings")}>{user ? "↗" : "•••"}</button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}>☰</button>
          <div className="breadcrumb"><span>My space</span><span className="breadcrumb-divider">/</span><strong>{navItems.find((item) => item.id === section)?.label ?? "Settings"}</strong></div>
          <div className="topbar-actions">
            <span className="demo-pill"><span className="demo-dot" /> {user ? "Your workspace" : "Demo workspace"}</span>
            <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`} aria-pressed={darkMode} title={`Switch to ${darkMode ? "light" : "dark"} mode`}><span aria-hidden="true">{darkMode ? "☀" : "☾"}</span><span className="theme-toggle-label">{darkMode ? "Light" : "Dark"}</span></button>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setMessage("You’re all caught up.")}><Icon>♧</Icon><span className="notification-dot" /></button>
            {user
              ? <button className="topbar-signin" onClick={() => void signOutUser()}>Sign out <span>↗</span></button>
              : <button className="topbar-signin" onClick={() => { setAuthMode("signup"); openModal("signin"); }}>Sign in <span>↗</span></button>}
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase()} <span className="eyebrow-leaf">✳</span></div>
              <h1>{heroTitle.title}</h1>
              <p>{heroTitle.subtitle}</p>
            </div>
            <button className="connect-button" onClick={() => { setFormError(""); openModal("connect"); }}><span>＋</span> Connect bank</button>
          </div>

          {!user && <div className="demo-notice"><span className="notice-icon">i</span><span>{configured ? "Sample numbers are for preview only. Create an account to save your own budget." : "Demo mode is on. Configure Firebase to create an account and sync your budget."}</span><button onClick={() => { setAuthMode("signup"); openModal("signin"); }}>Set up account <span>↗</span></button></div>}

          {section === "overview" && (
            <>
              <section className="overview-grid">
                <article className="safe-card">
                  <div className="safe-card-top"><span className="safe-label">SAFE TO SPEND</span><span className="safe-badge"><span>✦</span> Looking good</span></div>
                  <div className="safe-amount">{formatMoney(availableCents)}</div>
                  <p className="safe-explainer">After your category plans, you have this much room to breathe.</p>
                  <div className="safe-progress"><span style={{ width: `${Math.max(12, Math.min(100, Math.round(availableCents / Math.max(plannedCents, 1) * 100)))}%` }} /></div>
                  <div className="safe-card-foot"><span>Available this month</span><span>{formatMoney(availableCents)} <i>↗</i></span></div>
                  <div className="safe-decoration safe-decoration-one" /><div className="safe-decoration safe-decoration-two" />
                </article>

                <article className="metric-card income-card">
                  <div className="metric-heading"><span className="metric-icon income-icon">↙</span><span className="metric-period">THIS MONTH <span>⌄</span></span></div>
                  <span className="metric-title">Money in</span><strong>{formatMoney(monthIncome)}</strong>
                  <div className="metric-change positive"><span>↗</span> From deposits & income</div>
                  <div className="sparkline sparkline-green"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
                </article>

                <article className="metric-card spending-card">
                  <div className="metric-heading"><span className="metric-icon spending-icon">↗</span><span className="metric-period">THIS MONTH <span>⌄</span></span></div>
                  <span className="metric-title">Money out</span><strong>{formatMoney(monthSpent)}</strong>
                  <div className="metric-change muted"><span>◷</span> Across {visibleCategories.length} categories</div>
                  <div className="sparkline sparkline-amber"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
                </article>
              </section>

              <section className="content-grid">
                <article className="panel category-panel">
                  <div className="panel-heading"><div><h2>Your categories</h2><p>Here’s how your plan is holding up.</p></div><button className="text-link" onClick={() => chooseSection("categories")}>See all <span>↗</span></button></div>
                  <div className="category-list">
                    {visibleCategories.slice(0, 5).map((category) => {
                      const progress = category.targetCents > 0 ? Math.min(100, Math.round(category.spentCents / category.targetCents * 100)) : 0;
                      return <div className="category-row" key={category.id}>
                        <div className="category-symbol" style={{ color: category.color, backgroundColor: `${category.color}18` }}>{category.icon}</div>
                        <div className="category-main"><div className="category-title-row"><strong>{category.name}</strong><span>{category.targetPercent}% <span className="target-word">of income</span></span></div>
                          <div className="category-bar"><span style={{ width: `${progress}%`, background: category.color }} /></div>
                          <div className="category-meta"><span>{formatMoney(category.spentCents)} spent</span><span>{formatMoney(category.balanceCents)} left</span></div>
                        </div>
                      </div>;
                    })}
                  </div>
                  <button className="add-inline" onClick={() => openModal("category")}><span>＋</span> Add a category</button>
                </article>

                <article className="panel activity-panel">
                  <div className="panel-heading"><div><h2>Recent activity</h2><p>The latest from your budget.</p></div><button className="text-link" onClick={() => chooseSection("activity")}>View all <span>↗</span></button></div>
                  <TransactionList transactions={transactions.slice(0, 4)} categories={visibleCategories} />
                  <button className="add-transaction-link" onClick={() => openModal("transaction")}><span>＋</span> Add a transaction</button>
                </article>
              </section>

              <section className="lower-grid">
                <article className="panel goals-panel">
                  <div className="panel-heading"><div><h2>Dreams in progress</h2><p>A little closer, every day.</p></div><button className="text-link" onClick={() => chooseSection("goals")}>All goals <span>↗</span></button></div>
                  {activeGoal && <div className="featured-goal">
                    <div className="goal-art"><span>✳</span><i>✦</i></div>
                    <div className="goal-content"><div className="goal-name-row"><strong>{activeGoal.name}</strong><span>{activeGoal.due}</span></div>
                      <div className="goal-progress"><span style={{ width: `${Math.min(100, activeGoal.savedCents / activeGoal.targetCents * 100)}%` }} /></div>
                      <div className="goal-amount-row"><span><strong>{formatMoney(activeGoal.savedCents)}</strong> saved</span><span>of {formatMoney(activeGoal.targetCents)}</span></div>
                    </div>
                  </div>}
                  <button className="add-inline" onClick={() => openModal("goal")}><span>＋</span> Start a savings goal</button>
                </article>
                <article className="panel plan-panel">
                  <div className="panel-heading"><div><h2>Your split plan</h2><p>How each new deposit gets shared.</p></div><button className="edit-plan-button" onClick={() => chooseSection("categories")}>Edit plan <span>↗</span></button></div>
                  <div className="plan-total"><span>Monthly plan</span><strong>{percentageTotal}% <span>allocated</span></strong></div>
                  <div className="split-stacked-bar">{visibleCategories.filter((category) => category.targetPercent > 0).map((category) => <span key={category.id} style={{ width: `${category.targetPercent}%`, background: category.color }} title={`${category.name}: ${category.targetPercent}%`} />)}</div>
                  <div className="plan-legend">{visibleCategories.slice(0, 4).map((category) => <span key={category.id}><i style={{ background: category.color }} />{category.name}</span>)}</div>
                  <div className="plan-note"><span>✦</span> The remaining {100 - percentageTotal}% stays available for the unexpected.</div>
                </article>
              </section>
            </>
          )}

          {section === "activity" && <section className="panel full-panel"><div className="panel-heading"><div><h2>All activity</h2><p>Income and expenses for this month.</p></div><button className="primary-button small-primary" onClick={() => openModal("transaction")}>＋ Add transaction</button></div>
            <div className="activity-summary"><span><small>Money in</small><strong>{formatMoney(monthIncome)}</strong></span><span><small>Money out</small><strong>{formatMoney(monthSpent)}</strong></span><span><small>Transactions</small><strong>{monthTransactions.length}</strong></span></div>
            <div className="activity-table"><div className="table-header"><span>TRANSACTION</span><span>CATEGORY</span><span>DATE</span><span>AMOUNT</span></div>{recent.map((transaction) => <TransactionTableRow key={transaction.id} transaction={transaction} categories={visibleCategories} />)}</div>
            {transactions.length > 5 && <button className="add-inline centered" onClick={() => setShowAllTransactions(!showAllTransactions)}>{showAllTransactions ? "Show fewer" : "Show all transactions"}</button>}
          </section>}

          {section === "categories" && <section className="panel full-panel"><div className="panel-heading"><div><h2>Category plan</h2><p>{percentageTotal}% of deposits allocated · {100 - percentageTotal}% left flexible</p></div><button className="primary-button small-primary" onClick={() => openModal("category")}>＋ Add category</button></div>
            <div className="category-total-strip"><span>Combined percentage</span><strong className={percentageTotal > 100 ? "danger-text" : ""}>{percentageTotal}% <small>/ 100%</small></strong><div className="category-total-track"><span style={{ width: `${Math.min(percentageTotal, 100)}%` }} /></div></div>
            <div className="all-category-list">{visibleCategories.map((category) => <div className="all-category-row" key={category.id}><div className="category-symbol" style={{ color: category.color, backgroundColor: `${category.color}18` }}>{category.icon}</div><div className="all-category-name"><strong>{category.name}</strong><span>{category.kind === "savings" ? "Savings envelope" : "Spending category"}</span></div><div className="all-category-percent">{category.targetPercent}%<small> of each deposit</small></div><div className="all-category-balance"><strong>{formatMoney(category.balanceCents)}</strong><small>remaining</small></div></div>)}</div>
            <div className="footnote-box"><span>✦</span> We split deposits to the cent. If your categories use less than 100%, the rest stays in Safe to Spend.</div>
          </section>}

          {section === "goals" && <section className="goals-page"><div className="goals-page-heading"><div><span className="eyebrow">MAKE ROOM FOR WHAT MATTERS</span><h2>Your savings goals</h2></div><button className="primary-button" onClick={() => openModal("goal")}>＋ New goal</button></div><div className="goals-card-grid">{goals.map((goal, index) => <article className="goal-card" key={goal.id}><div className={`goal-card-art goal-card-art-${index % 3}`}><span>{index % 2 === 0 ? "✳" : "✦"}</span><i>✧</i></div><div className="goal-card-body"><span className="goal-due">TARGET · {goal.due}</span><h3>{goal.name}</h3><div className="goal-card-amount"><strong>{formatMoney(goal.savedCents)}</strong><span>of {formatMoney(goal.targetCents)}</span></div><div className="goal-progress goal-progress-large"><span style={{ width: `${Math.min(100, goal.savedCents / goal.targetCents * 100)}%` }} /></div><div className="goal-card-foot"><span>{Math.round(goal.savedCents / goal.targetCents * 100)}% there</span><button onClick={() => { setSelectedGoalId(goal.id); openModal("contribution"); }}>Add money <span>↗</span></button></div></div></article>)}<button className="new-goal-card" onClick={() => openModal("goal")}><span className="new-goal-plus">＋</span><strong>What are you saving for?</strong><small>Start with a little idea.</small></button></div></section>}

          {section === "trends" && <section className="trends-grid"><article className="panel chart-panel"><div className="panel-heading"><div><h2>Spending over time</h2><p>Monthly totals from your recent activity.</p></div><button className="period-select">Last 6 months <span>⌄</span></button></div><div className="chart-legend"><span><i className="legend-spend" /> Spending</span><span><i className="legend-income" /> Income</span></div><div className="bar-chart"><div className="chart-axis"><span>$4k</span><span>$3k</span><span>$2k</span><span>$1k</span><span>$0</span></div><div className="chart-plot"><div className="chart-grid-lines"><i /><i /><i /><i /><i /></div>{[{m:"May",s:46,i:72},{m:"Jun",s:55,i:84},{m:"Jul",s:43,i:65},{m:"Aug",s:64,i:90},{m:"Sep",s:52,i:76},{m:"Oct",s:40,i:62}].map((item)=><div className="chart-month" key={item.m}><div className="chart-bars"><i style={{height:`${item.s}%`}}/><i style={{height:`${item.i}%`}}/></div><span>{item.m}</span></div>)}</div></div><div className="chart-callout"><span>✦</span><div><strong>Nice balance this month.</strong><p>You’ve spent {formatMoney(monthSpent)} so far, while keeping your categories on track.</p></div></div></article><article className="panel insight-panel"><div className="insight-spark">✦</div><span className="eyebrow">A LITTLE INSIGHT</span><h2>Your plan has a nice bit of breathing room.</h2><p>You’ve set aside {percentageTotal}% of your deposits. Keeping a portion flexible can help with the little surprises student life brings.</p><button className="text-link" onClick={() => chooseSection("categories")}>Review your plan <span>↗</span></button></article></section>}

          {section === "settings" && <section className="settings-grid">
            <article className="panel settings-panel"><div className="panel-heading"><div><h2>Profile</h2><p>Basic account details.</p></div></div><div className="settings-profile"><div className="avatar avatar-large">{profileInitials}</div><div><strong>{profileName}</strong><span>{user ? "Student account" : "Demo student account"}</span></div></div><div className="settings-field"><span>Email</span><strong>{user?.email || "Sign in to add your email"}</strong></div><div className="settings-field"><span>Currency</span><strong>USD · US Dollar</strong></div>
              <button className="primary-button settings-connect" onClick={() => { setFormError(""); openModal("connect"); }}>{bankConnected ? "Bank connected · sync" : "Connect a bank"} <span>↗</span></button>
            </article>
            <article className="panel settings-panel"><div className="panel-heading"><div><h2>Privacy & security</h2><p>Your financial data belongs to you.</p></div></div><div className="security-row"><span className="security-check">✓</span><div><strong>Private by default</strong><small>Only your account can read its budget; writes are validated in Cloud Functions.</small></div></div><div className="security-row"><span className="security-check">✓</span><div><strong>Bank details stay protected</strong><small>Plaid access tokens are server-side only and cannot be read by the client.</small></div></div><div className="security-row"><span className="security-check">✓</span><div><strong>30-minute idle sign-out</strong><small>Your session is scoped to this browser tab.</small></div></div><button className="primary-button settings-connect" onClick={() => user ? void signOutUser() : (setAuthMode("signup"), openModal("signin"))}>{user ? "Sign out" : "Create your account"} <span>↗</span></button></article>
          </section>}

          <footer className="footer-note"><span>Made for the in-between moments.</span><span>IcebreaK <i>·</i> Your money, your pace.</span></footer>
        </div>
      </main>

      {message && <div role="status" className="toast"><span>✓</span>{message}<button onClick={() => setMessage("")} aria-label="Dismiss">×</button></div>}
      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={() => setModal(null)} aria-label="Close dialog">×</button>
        {modal === "transaction" && <><span className="modal-kicker">BUDGET UPDATE</span><h2 id="modal-title">Add a transaction</h2><p className="modal-description">Keep your plan up to date, one step at a time.</p><form onSubmit={handleTransaction} className="modal-form"><label>What was it for?<input name="description" autoFocus placeholder="e.g. Coffee with a friend" maxLength={80} required /></label><div className="form-row"><label>Amount<input name="amount" inputMode="decimal" placeholder="0.00" required /></label><label>Type<select name="type"><option value="expense">Expense</option><option value="income">Income / deposit</option></select></label></div><label>Category<select name="categoryId"><option value="available">Safe to Spend</option>{categories.map((category)=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>{formError && <p className="form-error">{formError}</p>}<button className="primary-button modal-submit" type="submit">Save transaction <span>↗</span></button></form></>}
        {modal === "goal" && <><span className="modal-kicker">A THING TO LOOK FORWARD TO</span><h2 id="modal-title">Start a savings goal</h2><p className="modal-description">Give your next big thing a name and a number.</p><form onSubmit={handleGoal} className="modal-form"><label>Goal name<input name="name" autoFocus placeholder="e.g. New laptop" maxLength={50} required /></label><div className="form-row"><label>Target amount<input name="target" inputMode="decimal" placeholder="0.00" required /></label><label>Target date <span className="optional-label">optional</span><input name="due" placeholder="e.g. May 2027" maxLength={24} /></label></div>{formError && <p className="form-error">{formError}</p>}<button className="primary-button modal-submit" type="submit">Create goal <span>↗</span></button></form></>}
        {modal === "category" && <><span className="modal-kicker">MAKE YOUR PLAN YOURS</span><h2 id="modal-title">Add a category</h2><p className="modal-description">Choose a slice of each deposit for this part of your life.</p><form onSubmit={handleCategory} className="modal-form"><label>Category name<input name="name" autoFocus placeholder="e.g. Textbooks" maxLength={40} required /></label><div className="form-row"><label>Percentage of income<input name="percentage" type="number" min="0" max="100" step="1" placeholder="10" required /></label><label>Kind<select name="kind"><option value="spending">Spending</option><option value="savings">Savings</option></select></label></div><p className="form-helper">Currently allocated: {percentageTotal}% of 100%.</p>{formError && <p className="form-error">{formError}</p>}<button className="primary-button modal-submit" type="submit">Add category <span>↗</span></button></form></>}
        {modal === "contribution" && <><span className="modal-kicker">SMALL STEPS ADD UP</span><h2 id="modal-title">Add to your goal</h2><p className="modal-description">Move money from your savings category or Safe to Spend into this goal.</p><form onSubmit={handleContribution} className="modal-form"><label>Contribution amount<input name="amount" inputMode="decimal" placeholder="0.00" autoFocus required /></label>{formError && <p className="form-error">{formError}</p>}<button className="primary-button modal-submit" type="submit">Add contribution <span>↗</span></button></form></>}
        {modal === "connect" && <><div className="modal-icon-art">↗</div><span className="modal-kicker">SECURE BANK CONNECTION</span><h2 id="modal-title">{bankConnected ? "Your bank is connected." : "See your whole picture."}</h2><p className="modal-description">Plaid Link keeps your bank credentials between you and your financial institution. IceBreak receives a token on the server and never exposes it to this browser.</p>{user ? <><div className="connection-steps"><span><i>1</i> {bankConnected ? "Your Plaid connection is active" : "Sign in to your bank through Plaid"}</span><span><i>2</i> Review and approve Transactions access</span><span><i>3</i> IceBreak imports recent activity</span></div>{formError && <p className="form-error">{formError}</p>}{bankConnected ? <button className="primary-button modal-submit" onClick={() => void syncBankTransactions()} disabled={syncingBank}>{syncingBank ? "Syncing…" : "Sync transactions now"} <span>↗</span></button> : <button className="primary-button modal-submit" onClick={() => void handleConnectBank()}>Open secure Plaid Link <span>↗</span></button>}</> : <><div className="connection-steps"><span><i>1</i> Create a Firebase account</span><span><i>2</i> Add your Plaid Sandbox credentials</span><span><i>3</i> Connect with Plaid Link</span></div><button className="primary-button modal-submit" onClick={() => { setAuthMode("signup"); openModal("signin"); }}>Create account <span>↗</span></button></>}</>}
        {modal === "signin" && <><div className="modal-icon-art">✳</div><span className="modal-kicker">YOUR MONEY, YOUR PACE</span><h2 id="modal-title">{authMode === "signup" ? "Make this space yours." : "Welcome back."}</h2>{configured ? <><p className="modal-description">Your account keeps your own budget and transactions private. Sessions sign out after 30 minutes without activity.</p><form onSubmit={handleAuth} className="modal-form">{authMode === "signup" && <label>Your name<input name="name" autoFocus placeholder="e.g. Alex Rivera" maxLength={80} required /></label>}<label>Email<input name="email" type="email" autoFocus={authMode === "signin"} autoComplete="email" required /></label><label>Password<input name="password" type="password" minLength={6} autoComplete={authMode === "signup" ? "new-password" : "current-password"} required /></label>{formError && <p className="form-error">{formError}</p>}<button className="primary-button modal-submit" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "signup" ? "Create account" : "Sign in"} <span>↗</span></button></form><button className="text-link" onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setFormError(""); }}>{authMode === "signup" ? "Already have an account? Sign in" : "New to IceBreak? Create an account"}</button></> : <><p className="modal-description">Firebase isn’t configured in this deployment yet. You can keep exploring the sample workspace; account creation will be available after setup.</p><button className="primary-button modal-submit" onClick={() => setModal(null)}>Continue in demo <span>↗</span></button></>}</>}
      </section></div>}
    </div>
  );
}

function TransactionList({ transactions, categories }: { transactions: Transaction[]; categories: BudgetCategory[] }) {
  return <div className="transaction-list">{transactions.map((transaction) => {
    const category = categories.find((item) => item.id === transaction.categoryId);
    return <div className="transaction-row" key={transaction.id}><div className={`transaction-icon ${transaction.type === "income" ? "transaction-income" : ""}`}>{transaction.type === "income" ? "↙" : category?.icon ?? "◦"}</div><div className="transaction-description"><strong>{transaction.description}</strong><span>{category?.name ?? (transaction.type === "income" ? "Deposit" : "Safe to Spend")} <i>·</i> {dateLabel(transaction.date)}</span></div><strong className={`transaction-amount ${transaction.type === "income" ? "amount-income" : ""}`}>{transaction.type === "income" ? "+" : "−"}{formatMoney(transaction.amountCents)}</strong></div>;
  })}</div>;
}

function TransactionTableRow({ transaction, categories }: { transaction: Transaction; categories: BudgetCategory[] }) {
  const category = categories.find((item) => item.id === transaction.categoryId);
  return <div className="table-row"><div className="table-transaction"><span className={`transaction-icon ${transaction.type === "income" ? "transaction-income" : ""}`}>{transaction.type === "income" ? "↙" : category?.icon ?? "◦"}</span><strong>{transaction.description}</strong></div><span>{category?.name ?? "Safe to Spend"}</span><span>{dateLabel(transaction.date)}</span><strong className={`transaction-amount ${transaction.type === "income" ? "amount-income" : ""}`}>{transaction.type === "income" ? "+" : "−"}{formatMoney(transaction.amountCents)}</strong></div>;
}

