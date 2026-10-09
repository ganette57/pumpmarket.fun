"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRealOpenPositions } from "@/hooks/useRealOpenPositions";
import type { RealOpenPosition } from "@/lib/realPositionDisplay";

const sol = (lamports: number) => `${(lamports / 1e9).toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;

export function RealPositionCard({ position: p, usd }: { position: RealOpenPosition; usd: number | null }) {
  return <Link href={`/trade/${p.marketAddress}`} className="block min-w-0 rounded-xl border border-gray-800 bg-pump-dark/40 p-3 transition hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump-green">
    <div className="truncate text-sm text-white">{p.title}</div>
    <div className="mt-0.5 truncate text-xs text-gray-400">Pick: <span className={`font-semibold ${p.outcomeIndex === 0 ? "text-pump-green" : "text-[#ff5c73]"}`}>{p.outcomeName}</span></div>
    <div className="mt-2 flex items-center justify-between gap-3">
      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold tracking-wide text-gray-400">OPEN</span>
      <div className="min-w-0 text-right">
        <div className="text-[10px] text-gray-500">Est. payout if resolved now</div>
        <div className="break-words text-sm font-bold tabular-nums text-pump-green">{p.payoutLamports == null ? "—" : sol(p.payoutLamports)}</div>
      </div>
    </div>
    <div className="mt-1 flex items-start justify-between gap-3 text-[11px] text-gray-500">
      <div className="min-w-0 tabular-nums">
        {p.marketNetStakeLamports == null ? "Recorded stake unavailable" : <>
          <span>{sol(p.marketNetStakeLamports)} net staked (excl. fees){p.heldOutcomeCount > 1 ? " in market" : ""}</span>
          {usd != null && <span className="block">≈ {(p.marketNetStakeLamports / 1e9 * usd).toLocaleString(undefined, { style: "currency", currency: "USD" })} at current SOL price</span>}
          {p.heldOutcomeCount > 1 && <span className="block">Across all outcomes; per-pick stake unavailable</span>}
        </>}
      </div>
      {p.lastTradeAt && <time dateTime={p.lastTradeAt} className="shrink-0" title={new Date(p.lastTradeAt).toLocaleString()}>{new Date(p.lastTradeAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</time>}
    </div>
  </Link>;
}

export default function RealOpenPositions({ wallet }: { wallet: string }) {
  const state = useRealOpenPositions(wallet);
  const [price, setPrice] = useState<{ usd: number; as_of: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let expiry: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch("/api/real/sol-price");
        const { sol_usd: next } = await response.json();
        if (cancelled) return;
        clearTimeout(expiry);
        const remaining = 15 * 60_000 - (Date.now() - Date.parse(next?.as_of));
        if (!response.ok || !Number.isFinite(next?.usd) || next.usd <= 0 || !(remaining > 0)) { setPrice(null); return; }
        setPrice(next);
        expiry = setTimeout(() => setPrice(null), remaining);
      } catch { if (!cancelled) setPrice(null); }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; clearTimeout(expiry); window.removeEventListener("focus", refresh); };
  }, []);
  return <section className="mx-auto mt-6 max-w-6xl px-4" aria-label="Open REAL positions">
    <h2 className="mb-3 text-sm font-semibold text-white">Open positions</h2>
    {!state ? <p className="text-sm text-gray-500">Loading positions…</p> : state.error ? <p className="text-sm text-gray-500">Positions unavailable. Return to this tab to retry.</p> : state.rows.length === 0 ? <p className="text-sm text-gray-500">No open positions.</p> : <div className="grid gap-2 md:grid-cols-2">{state.rows.map(p => <RealPositionCard key={`${p.marketAddress}:${p.outcomeIndex}`} position={p} usd={price?.usd ?? null} />)}</div>}
  </section>;
}
