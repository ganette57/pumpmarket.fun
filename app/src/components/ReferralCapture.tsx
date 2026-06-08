"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const STORAGE_KEY = "fm_ref_code";

// Reads ?ref=XXX from the URL on first mount and stashes it locally so we
// can attribute the visitor to a referrer once they connect a wallet.
// Once the wallet is connected, POSTs to /api/rewards/record-referral —
// the server resolves the code, creates the referral row (if it doesn't
// already exist), and awards the signup bonus.
//
// This component is invisible. Drop it once near the root.
export default function ReferralCapture() {
  const { connected, publicKey } = useWallet();
  const triedRef = useRef(false);

  // Stash ref code on first load if present
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      const ref = url.searchParams.get("ref");
      if (ref) {
        const cur = window.localStorage.getItem(STORAGE_KEY);
        if (!cur) {
          window.localStorage.setItem(STORAGE_KEY, ref.trim());
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Try to register the referral when a wallet connects
  useEffect(() => {
    if (!connected || !publicKey) return;
    if (triedRef.current) return;

    let code: string | null = null;
    try { code = window.localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
    if (!code) return;

    triedRef.current = true;
    const referred = publicKey.toBase58();
    fetch("/api/rewards/record-referral", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referrerCode: code, referred }),
    })
      .then(async (r) => {
        if (r.ok) {
          // Clear so we don't keep retrying for the same wallet
          try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        }
      })
      .catch(() => { /* ignore */ });
  }, [connected, publicKey]);

  return null;
}
