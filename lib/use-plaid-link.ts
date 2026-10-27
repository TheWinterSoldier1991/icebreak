"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PlaidHandler = { open: () => void; exit: (options?: { force?: boolean }) => void; destroy: () => void };
type PlaidLinkOptions = {
  token: string | null;
  onSuccess: (publicToken: string) => void;
};

declare global {
  interface Window {
    Plaid?: {
      create: (options: {
        token: string;
        onSuccess: (publicToken: string, metadata: unknown) => void;
        onExit?: (error: unknown, metadata: unknown) => void;
      }) => PlaidHandler;
    };
  }
}

let plaidScriptPromise: Promise<void> | null = null;

function loadPlaidScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("Plaid Link requires a browser."));
  if (window.Plaid) return Promise.resolve();
  if (plaidScriptPromise) return plaidScriptPromise;
  plaidScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.dataset.icebreakPlaid = "true";
    script.onload = () => window.Plaid ? resolve() : reject(new Error("Plaid Link did not initialize."));
    script.onerror = () => {
      plaidScriptPromise = null;
      reject(new Error("Could not load Plaid Link. Check your network and try again."));
    };
    document.head.appendChild(script);
  });
  return plaidScriptPromise;
}

export function usePlaidLink({ token, onSuccess }: PlaidLinkOptions) {
  const [ready, setReady] = useState(false);
  const handler = useRef<PlaidHandler | null>(null);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  useEffect(() => {
    let active = true;
    handler.current?.destroy();
    handler.current = null;
    setReady(false);
    if (!token) return () => { active = false; };

    void loadPlaidScript().then(() => {
      if (!active || !window.Plaid) return;
      handler.current = window.Plaid.create({
        token,
        onSuccess: (publicToken) => { void onSuccessRef.current(publicToken); },
      });
      setReady(true);
    }).catch(() => setReady(false));

    return () => {
      active = false;
      handler.current?.destroy();
      handler.current = null;
    };
  }, [token]);

  const open = useCallback(() => handler.current?.open(), []);
  return { ready, open };
}
