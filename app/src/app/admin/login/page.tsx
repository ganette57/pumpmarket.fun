"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAdminWallet } from "@/lib/adminClient";

function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export default function AdminLoginPage() {
  const { publicKey, connected } = useWallet();
  const wallet = publicKey?.toBase58() || "";

  const adminWallet = useMemo(() => {
    return (process.env.NEXT_PUBLIC_ADMIN_WALLET || "").trim();
  }, []);

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function login() {
    setMsg(null);

    if (!connected || !wallet) {
      setMsg("Connect your wallet first.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, password }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Login failed");

      const next = new URLSearchParams(window.location.search).get("next") || "/admin";
      window.location.href = next;
    } catch (e: any) {
      setMsg(e?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-pump max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">Admin login</h1>
      <p className="text-sm text-gray-400 mb-4">
        Wallet: <span className="font-mono text-white/80">{connected ? shortAddr(wallet) : "not connected"}</span>
      </p>

      <div className="mb-3">
        <div className="text-xs text-gray-500 mb-1">Allowed admin wallet</div>
        <div className="text-sm font-mono text-white/80">{shortAddr(adminWallet)}</div>
      </div>

      <div className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="ADMIN_PASSWORD"
          className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-pump-green/60"
          type="password"
        />
      </div>

      {msg && (
        <div className="mb-4 text-sm text-red-200 border border-red-500/30 bg-red-500/10 rounded-lg p-2">
          {msg}
        </div>
      )}

      <button
        onClick={login}
        disabled={busy}
        className={[
          "w-full px-4 py-2.5 rounded-xl font-semibold transition",
          busy ? "bg-gray-700 text-gray-300 cursor-not-allowed" : "bg-pump-green text-black hover:opacity-90",
        ].join(" ")}
      >
        {busy ? "Checking…" : "Enter admin"}
      </button>

      <p className="text-xs text-gray-500 mt-3">
        Note: this sets a secure cookie. You must be connected with the admin wallet.
      </p>
    </div>
  );
}