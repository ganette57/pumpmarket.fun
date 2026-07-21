"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Copy, Check, Users, Sparkles } from "lucide-react";
import { getReferralSummary, type ReferralSummary } from "@/lib/funPoints";

// Referrals.
//
// Only shows what is actually backed by real data today: the wallet's
// referral code, its shareable link, and how many wallets have signed up
// through it. Earnings are deliberately NOT displayed — fee-based referral
// accounting does not exist yet, and the Fun Points figures that used to sit
// here do not represent real earnings.

export default function ReferralsPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReferral(await getReferralSummary(wallet));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { void load(); }, [load]);

  const referralCode = referral?.code ?? "—";
  const referralLink = referral?.link ?? "";
  const referralInvited = referral?.invited ?? 0;

  async function handleCopy() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = referralLink;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="min-h-screen bg-pump-dark px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Page header */}
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-pump-green/30 bg-pump-green/10">
            <Users className="h-5 w-5 text-pump-green" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Referrals
            </h1>
            <p className="text-sm text-gray-400">
              Invite traders and earn rewards from eligible activity.
            </p>
          </div>
        </header>

        {!wallet && (
          <div className="rounded-2xl border border-pump-green/25 bg-pump-gray p-4 text-sm text-gray-300">
            Connect your wallet to get your referral code.
          </div>
        )}

        {/* Referral code + link */}
        <section className="relative overflow-hidden rounded-2xl border border-pump-green/50 bg-gradient-to-br from-pump-gray to-black p-6 shadow-[0_0_60px_rgba(0,255,135,0.15)] md:p-8">
          {/* glow */}
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-pump-green/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-pump-green/10 blur-3xl" />

          <div className="relative">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 self-start rounded-full border border-pump-green/40 bg-black/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-pump-green">
              <Sparkles className="h-3 w-3" />
              Invite &amp; earn
            </div>

            {/* Headline */}
            <h2 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-white md:text-3xl">
              Invite traders
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-300 md:text-base">
              Share your link. Anyone who connects a wallet through it is
              permanently attributed to you.
            </p>

            {/* Code */}
            <div className="mt-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Your referral code
              </div>
              <div className="mt-1 font-mono text-2xl font-extrabold tracking-wider text-white md:text-3xl">
                {loading ? "…" : referralCode}
              </div>
            </div>

            {/* Link */}
            <div className="mt-4">
              <label
                htmlFor="referral-link"
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400"
              >
                Your referral link
              </label>
              <input
                id="referral-link"
                type="text"
                readOnly
                value={referralLink}
                className="mt-1 w-full rounded-xl border border-gray-700/60 bg-black/60 px-3 py-3 font-mono text-xs text-gray-200 outline-none focus:border-pump-green/60 md:text-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>

            {/* Copy button — large, full-width on mobile, green */}
            <button
              type="button"
              onClick={handleCopy}
              disabled={!referralLink}
              aria-label="Copy referral link"
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-pump-green px-6 text-sm font-extrabold uppercase tracking-wide text-black transition hover:bg-pump-green/90 active:scale-[0.99] disabled:opacity-50 md:w-auto md:text-base"
            >
              {copied ? (
                <>
                  <Check className="h-5 w-5" />
                  Link copied!
                </>
              ) : (
                <>
                  <Copy className="h-5 w-5" />
                  Copy referral link
                </>
              )}
            </button>

            {/* The only figure we can state truthfully today. */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat
                label="Traders referred"
                value={loading ? "—" : referralInvited.toLocaleString("en-US")}
                hint="Wallets that signed up with your link"
                accent
              />
              <Stat
                label="Referral earnings"
                value="Not available yet"
                hint="Fee sharing is not live — nothing has accrued"
              />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="rounded-2xl border border-pump-border bg-pump-gray p-5">
          <h2 className="text-sm font-semibold text-white">How it works</h2>
          <ol className="mt-3 space-y-3 text-sm text-gray-300">
            <Step n={1}>Copy your referral link and share it.</Step>
            <Step n={2}>
              A trader opens it and connects their wallet — they&apos;re attributed
              to you from then on.
            </Step>
            <Step n={3}>
              Your referral count updates here. Fee sharing on referred trading
              activity is not live yet.
            </Step>
          </ol>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-black/50 px-4 py-3 ${accent ? "border-pump-green/40" : "border-white/10"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mt-1 text-xl font-extrabold md:text-2xl ${accent ? "tabular-nums text-pump-green" : "text-gray-300"}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-pump-green/30 bg-pump-green/10 text-[11px] font-bold text-pump-green">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}
