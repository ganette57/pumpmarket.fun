"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { AlertCircle, Calculator, Check, Copy, Info, Minus, Plus, Share2, TrendingUp, Users, X } from "lucide-react";
import { getReferralSummary, type ReferralSummary } from "@/lib/funPoints";

type LinkStatus = "idle" | "copied" | "error";
const CURRENCY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function clampNumber(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export default function ReferralsPage() {
  const { publicKey } = useFunMarketWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>("idle");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [traders, setTraders] = useState(1);
  const [monthlyVolume, setMonthlyVolume] = useState(1000);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReferral(await getReferralSummary(wallet)); }
    finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [drawerOpen]);

  // Never expose the generic fallback returned for a disconnected wallet.
  const referralLink = wallet ? referral?.link ?? "" : "";
  const invited = referral?.invited ?? 0;
  const activeTraders = referral?.successfulTrades ?? 0;
  const earnings = useMemo(() => {
    const totalVolume = traders * monthlyVolume;
    return { minimum: totalVolume * 0.01 * 0.3, maximum: totalVolume * 0.03 * 0.3 };
  }, [monthlyVolume, traders]);

  const copyReferralLink = useCallback(async () => {
    if (!referralLink) return false;
    try {
      await navigator.clipboard.writeText(referralLink);
      setLinkStatus("copied");
      window.setTimeout(() => setLinkStatus("idle"), 1800);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = referralLink;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        const copied = document.execCommand("copy");
        if (!copied) throw new Error("Copy command failed");
        setLinkStatus("copied");
        window.setTimeout(() => setLinkStatus("idle"), 1800);
        return true;
      } catch {
        setLinkStatus("error");
        window.setTimeout(() => setLinkStatus("idle"), 2600);
        return false;
      } finally { document.body.removeChild(textarea); }
    }
  }, [referralLink]);

  async function handleShare() {
    if (!referralLink) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Trade on FunMarket", text: "Join me on FunMarket.", url: referralLink });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyReferralLink();
  }

  return (
    <main className="min-h-screen bg-pump-dark px-4 pb-28 pt-6 text-white sm:px-6 md:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="border-b border-white/10 pb-7 md:pb-9">
          <div className="inline-flex items-center rounded-full border border-pump-green/25 bg-pump-green/[0.07] px-3 py-1.5 text-[11px] font-semibold tracking-wide text-pump-green">Referral rewards — Coming soon</div>
          <h1 className="mt-5 max-w-2xl text-4xl font-black leading-[1.02] tracking-[-0.045em] sm:text-5xl md:text-6xl">Bring traders. Get paid.</h1>
          <p className="mt-3 text-base font-medium text-white/55 sm:text-lg">Earn <span className="font-extrabold text-pump-green">30%</span> of eligible trading fees. For life.</p>
        </header>

        <section className="py-7 md:py-9" aria-labelledby="referral-link-title">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pump-green">Your invite</p>
              <h2 id="referral-link-title" className="mt-1 text-xl font-bold">Referral link</h2>
            </div>
            <span className="text-xs text-white/35">Personal to your wallet</span>
          </div>
          {!wallet ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-5 text-sm text-white/55">Connect your wallet to get your personal referral link.</div>
          ) : (
            <>
              <div className="mt-4 min-w-0 rounded-2xl border border-white/10 bg-[#111311] px-4 py-4 shadow-[0_16px_50px_rgba(0,0,0,0.25)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Your personal link</p>
                <p className="mt-2 truncate font-mono text-sm text-white/80" title={referralLink}>{loading ? "Loading your link…" : referralLink}</p>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-3">
                <button type="button" onClick={() => void copyReferralLink()} disabled={!referralLink || loading} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-pump-green px-5 text-sm font-extrabold text-black transition hover:bg-[#20ff97] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40">
                  {linkStatus === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{linkStatus === "copied" ? "Copied" : "Copy link"}
                </button>
                <button type="button" onClick={() => void handleShare()} disabled={!referralLink || loading} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-5 text-sm font-bold text-white/80 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                  <Share2 className="h-4 w-4" /><span className="hidden sm:inline">Share</span>
                </button>
              </div>
              <div className="mt-2 min-h-5" role="status" aria-live="polite">
                {linkStatus === "copied" && <p className="text-xs text-pump-green">Link copied to your clipboard.</p>}
                {linkStatus === "error" && <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle className="h-3.5 w-3.5" /> Couldn&apos;t copy the link. Please try again.</p>}
              </div>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#111311] p-4 sm:p-5" aria-labelledby="calculator-title">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pump-green/10 text-pump-green"><Calculator className="h-4 w-4" /></div>
            <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Estimator</p><h2 id="calculator-title" className="text-lg font-bold">Calculate your earnings</h2></div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <NumberControl id="trader-count" label="Number of traders" value={traders} minimum={1} maximum={10000} step={1} onChange={setTraders} />
            <NumberControl id="monthly-volume" label="Monthly volume per trader" value={monthlyVolume} minimum={0} maximum={100000000} step={500} prefix="$" onChange={setMonthlyVolume} />
          </div>
          <div className="mt-5 rounded-2xl border border-pump-green/20 bg-black/35 p-5 text-center">
            <p className="text-xs font-medium text-white/45">Estimated monthly earnings</p>
            <p className="mt-1 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">{CURRENCY.format(earnings.minimum)} <span className="text-white/30">–</span> {CURRENCY.format(earnings.maximum)}</p>
            <p className="mt-1 text-xs font-semibold text-pump-green">per month</p>
            <p className="mt-3 text-[11px] text-white/35">Illustrative estimate, not guaranteed earnings.</p>
          </div>
        </section>

        <section className="py-7" aria-label="Referral statistics">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Stat icon={<Users className="h-4 w-4" />} label="Invited" value={loading ? "—" : invited.toLocaleString("en-US")} />
            <Stat icon={<TrendingUp className="h-4 w-4" />} label="Active traders" value={loading ? "—" : activeTraders.toLocaleString("en-US")} />
            <Stat icon={<Info className="h-4 w-4" />} label="Total earned" value="Coming soon" compact />
          </div>
        </section>
        <button type="button" onClick={() => setDrawerOpen(true)} className="flex h-12 w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm font-semibold text-white/70 transition hover:border-pump-green/30 hover:text-white">
          <span className="flex items-center gap-2"><Info className="h-4 w-4 text-pump-green" /> How earnings work</span><span aria-hidden className="text-white/30">↗</span>
        </button>
      </div>
      <EarningsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </main>
  );
}

function NumberControl({ id, label, value, minimum, maximum, step, prefix = "", onChange }: { id: string; label: string; value: number; minimum: number; maximum: number; step: number; prefix?: string; onChange: (value: number) => void }) {
  const update = (next: number) => onChange(clampNumber(next, minimum, maximum));
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-white/55">{label}</label>
      <div className="mt-2 grid h-12 grid-cols-[44px_1fr_44px] overflow-hidden rounded-xl border border-white/10 bg-black/35">
        <button type="button" onClick={() => update(value - step)} className="grid place-items-center border-r border-white/10 text-white/55 transition hover:bg-white/5 hover:text-white" aria-label={`Decrease ${label.toLowerCase()}`}><Minus className="h-4 w-4" /></button>
        <div className="flex min-w-0 items-center justify-center px-1 focus-within:ring-1 focus-within:ring-inset focus-within:ring-pump-green/60">
          {prefix && <span className="text-sm font-bold text-white/40">{prefix}</span>}
          <input id={id} type="number" inputMode="numeric" min={minimum} max={maximum} step={step} value={value} onChange={(event) => update(Number(event.target.value))} className="min-w-0 w-full appearance-none bg-transparent px-1 text-center text-base font-bold tabular-nums text-white outline-none" />
        </div>
        <button type="button" onClick={() => update(value + step)} className="grid place-items-center border-l border-white/10 text-white/55 transition hover:bg-white/5 hover:text-white" aria-label={`Increase ${label.toLowerCase()}`}><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, compact = false }: { icon: React.ReactNode; label: string; value: string; compact?: boolean }) {
  return <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.025] p-3 sm:p-4"><div className="text-pump-green">{icon}</div><p className={`mt-3 font-extrabold leading-tight ${compact ? "text-sm sm:text-base" : "text-xl sm:text-2xl"}`}>{value}</p><p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-white/35 sm:text-xs">{label}</p></div>;
}

function EarningsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[250] flex items-end" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} aria-label="Close earnings information" />
      <section role="dialog" aria-modal="true" aria-labelledby="earnings-drawer-title" className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-[#0b0d0c] px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl animate-fadeIn">
        <div className="mx-auto h-1 w-10 rounded-full bg-white/20" aria-hidden />
        <div className="mx-auto mt-5 flex w-full max-w-xl items-center justify-between">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-pump-green">Referral program</p><h2 id="earnings-drawer-title" className="mt-1 text-xl font-bold text-white">How earnings work</h2></div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/60 transition hover:border-white/25 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="mx-auto mt-6 w-full max-w-xl space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <DrawerStep number="1" title="Invite traders">Share your personal referral link.</DrawerStep>
            <DrawerStep number="2" title="They trade">Your referrals generate eligible trading fees.</DrawerStep>
            <DrawerStep number="3" title="Earn 30% for life">Receive 30% of eligible fees generated by your referrals for as long as they keep trading, once the program is activated.</DrawerStep>
          </div>
          <FeeCard title="User-created markets" badge="1% eligible">
            <p>Platform fee: <strong className="text-white">1%</strong></p><p>Creator fee: <strong className="text-white">2%</strong>, paid to the market creator.</p>
            <p className="mt-3 text-white/75">Referral share: 30% of the eligible 1% platform fee.</p><p className="mt-3 font-semibold text-pump-green">$1,000 volume → $3 potential earnings</p>
          </FeeCard>
          <FeeCard title="Official FunMarket markets" badge="Up to 3% eligible">
            <p>Markets created by the official FunMarket admin wallet.</p><p className="mt-2">Platform fee: <strong className="text-white">1%</strong></p><p>Creator fee: <strong className="text-white">2%</strong>, received by FunMarket.</p>
            <p className="mt-3 text-white/75">Planned referral share: 30% of the combined eligible 3% fees, subject to implementation and validation.</p><p className="mt-3 font-semibold text-pump-green">$1,000 volume → up to $9 potential earnings</p>
          </FeeCard>
          <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-4 text-xs leading-5 text-white/50">The commission program is coming soon and payments are not active. Eligible fees depend on the market type. All estimates are illustrative and not guaranteed.</div>
        </div>
      </section>
    </div>
  );
}

function DrawerStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-pump-green/10 text-xs font-bold text-pump-green">{number}</span><h3 className="mt-3 text-sm font-bold text-white">{title}</h3><p className="mt-1 text-xs leading-5 text-white/45">{children}</p></div>;
}

function FeeCard({ title, badge, children }: { title: string; badge: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-[#111311] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-extrabold uppercase tracking-wide text-white">{title}</h3><span className="rounded-full bg-pump-green/10 px-2.5 py-1 text-[10px] font-bold text-pump-green">{badge}</span></div><div className="mt-4 text-xs leading-5 text-white/50">{children}</div></div>;
}
