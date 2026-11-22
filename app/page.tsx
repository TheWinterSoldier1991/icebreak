"use client";
import { useEffect, useState, type FormEvent } from "react";
import { IceBreakApp } from "@/components/icebreak-app";
import { useAuth } from "@/lib/auth-context";
export default function HomePage() {
  const { user, ready, configured, signIn, signUp } = useAuth();
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (query.has("auth_error") || query.has("error") || hash.has("error")) {
      setNotice("This confirmation link has expired, was already used, or was opened in a different browser. If your email is confirmed, sign in with the password you created. You do not need to create another account.");
      window.history.replaceState(null, "", "/");
    }
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError(""); setNotice("");
    try {
      const email = String(data.get("email") ?? "");
      const password = String(data.get("password") ?? "");
      if (signup) {
        if (await signUp(String(data.get("name") ?? ""), email, password)) {
          form.reset(); setSignup(false);
          setNotice("Check your email to confirm your account, then sign in. If you already have an account, use your existing password.");
        }
      } else await signIn(email, password);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  if (ready && configured && user) return <IceBreakApp key={user.id} />;
  return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",padding:24,background:"#f7f8f4"}}>
    <section className="panel" style={{width:"100%",maxWidth:460,padding:32}} aria-labelledby="account-title">
      <span className="brand-name">IcebreaK.</span>
      {!ready ? <p role="status">Checking your session…</p> : !configured ? <h1 id="account-title">Account access is temporarily unavailable. Please try again later.</h1> : <>
        <h1 id="account-title">{signup ? "Make this space yours." : "Welcome back."}</h1>
        <p>Create an account to save your budget, or sign in to continue.</p>
        {notice && <p role="status">{notice}</p>}
        <form className="modal-form" onSubmit={submit}>
          {signup && <label>Your name<input name="name" autoComplete="name" maxLength={80} required disabled={busy}/></label>}
          <label>Email<input name="email" type="email" autoComplete="email" required disabled={busy}/></label>
          <label>Password<input name="password" type="password" minLength={6} autoComplete={signup ? "new-password" : "current-password"} required disabled={busy}/></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button modal-submit" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
        </form>
        <button className="text-link" disabled={busy} onClick={() => {setSignup(!signup);setError("");setNotice("");}}>{signup ? "Already have an account? Sign in" : "New here? Create an account"}</button>
      </>}
    </section>
  </main>;
}

