"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { firebaseConfigured, getFirebaseClient } from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  ready: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!firebaseConfigured);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    const client = getFirebaseClient();
    if (!client) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void client.persistenceReady.then(() => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(client.auth, (nextUser) => {
        setUser(nextUser);
        setReady(true);
        lastActivity.current = Date.now();
      });
    }).catch(() => setReady(true));
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const markActive = () => { lastActivity.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_TIMEOUT_MS) {
        const client = getFirebaseClient();
        if (client) void signOut(client.auth);
      }
    }, 30_000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActive));
      window.clearInterval(timer);
    };
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = getFirebaseClient();
    if (!client) throw new Error("Firebase is not configured yet. Use demo mode or finish the Firebase setup.");
    await client.persistenceReady;
    await signInWithEmailAndPassword(client.auth, email.trim(), password);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const client = getFirebaseClient();
    if (!client) throw new Error("Firebase is not configured yet. Use demo mode or finish the Firebase setup.");
    await client.persistenceReady;
    const credential = await createUserWithEmailAndPassword(client.auth, email.trim(), password);
    if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
    await sendEmailVerification(credential.user);
  }, []);

  const signOutUser = useCallback(async () => {
    const client = getFirebaseClient();
    if (client) await signOut(client.auth);
  }, []);

  const value = useMemo(() => ({ user, ready, configured: firebaseConfigured, signIn, signUp, signOutUser }), [user, ready, signIn, signUp, signOutUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
