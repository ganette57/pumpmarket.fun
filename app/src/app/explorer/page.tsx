"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Zap } from "lucide-react";
import FlashMarketCard from "@/components/FlashMarketCard";
import { supabase } from "@/lib/supabaseClient";
import type { FlashMarket, FlashMarketKind } from "@/lib/flashMarkets/types";

interface Market {
  market_address: string;
  question: string;
  category: string;
  image_url: string | null;
  market_type?: number;
  total_volume: number;
  end_date?: string;
  resolution_status?: string;
  resolved?: boolean;
  yes_supply?: number;
  no_supply?: number;
  outcome_supplies?: number[];
}

function lamportsToSol(lamports: number): number {
  return (lamports || 0) / 1_000_000_000;
}

function marketTopPct(m: Market): number {
  const supplies =
    Array.isArray(m.outcome_supplies) && m.outcome_supplies.length
      ? m.outcome_supplies.map((x) => Number(x) || 0)
      : [Number(m.yes_supply) || 0, Number(m.no_supply) || 0];

  const total = supplies.reduce((a: number, b: number) => a + b, 0);
  if (!total) return 0;

  const top = Math.max(...supplies);
  return Math.round((top / total) * 100);
}

type StatusFilter = "open" | "resolved";
type ResolvedSort = "newest" | "oldest" | "match";
const RESOLVED_PAGE_SIZE = 28;

export default function ExplorerPage() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";

  const [searchResults, setSearchResults] = useState<Market[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [sportsFlashMarkets, setSportsFlashMarkets] = useState<FlashMarket[]>([]);
  const [sportsFlashLoading, setSportsFlashLoading] = useState(true);
  const [cryptoFlashMarkets, setCryptoFlashMarkets] = useState<FlashMarket[]>([]);
  const [cryptoFlashLoading, setCryptoFlashLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [cryptoStatusFilter, setCryptoStatusFilter] = useState<StatusFilter>("open");
  const [irlStatusFilter, setIrlStatusFilter] = useState<StatusFilter>("open");
  const [resolvedSearch, setResolvedSearch] = useState("");
  const [resolvedSort, setResolvedSort] = useState<ResolvedSort>("newest");
  const [resolvedPage, setResolvedPage] = useState(1);
  const desktopResolvedGridTopRef = useRef<HTMLDivElement | null>(null);
  const mobileResolvedGridTopRef = useRef<HTMLDivElement | null>(null);

  const fetchFlashMarkets = useCallback(async (kind: FlashMarketKind, filter: StatusFilter) => {
    if (kind === "sport") setSportsFlashLoading(true);
    if (kind === "crypto") setCryptoFlashLoading(true);
    try {
      const limit = filter === "resolved" ? 200 : 20;
      const res = await fetch(
        `/api/explorer/flash-markets?limit=${limit}&status=${filter}&kind=${kind}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Flash markets fetch failed (${res.status})`);
      const json = await res.json();
      const rows = (json?.markets as FlashMarket[]) || [];
      if (kind === "sport") setSportsFlashMarkets(rows);
      if (kind === "crypto") setCryptoFlashMarkets(rows);
    } catch (error) {
      console.warn(`Flash ${kind} markets fetch failed:`, error);
      if (kind === "sport") setSportsFlashMarkets([]);
      if (kind === "crypto") setCryptoFlashMarkets([]);
    } finally {
      if (kind === "sport") setSportsFlashLoading(false);
      if (kind === "crypto") setCryptoFlashLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFlashMarkets("sport", statusFilter);
  }, [statusFilter, fetchFlashMarkets]);

  useEffect(() => {
    void fetchFlashMarkets("crypto", cryptoStatusFilter);
  }, [cryptoStatusFilter, fetchFlashMarkets]);

  const visibleFlashMarkets = useMemo(() => {
    if (statusFilter !== "resolved") return sportsFlashMarkets;
    const q = resolvedSearch.trim().toLowerCase();
    const filtered = q
      ? sportsFlashMarkets.filter((m) => {
          const match = `${m.homeTeam} vs ${m.awayTeam}`.toLowerCase();
          const question = String(m.question || "").toLowerCase();
          const windowLabel = m.loopSequence != null ? `window #${m.loopSequence}` : "";
          return (
            match.includes(q) ||
            question.includes(q) ||
            String(m.homeTeam || "").toLowerCase().includes(q) ||
            String(m.awayTeam || "").toLowerCase().includes(q) ||
            windowLabel.includes(q)
          );
        })
      : [...sportsFlashMarkets];

    const createdMs = (m: FlashMarket) => {
      const t = Date.parse(String(m.createdAt || ""));
      return Number.isFinite(t) ? t : 0;
    };

    filtered.sort((a, b) => {
      if (resolvedSort === "oldest") return createdMs(a) - createdMs(b);
      if (resolvedSort === "match") {
        const matchA = `${a.homeTeam} vs ${a.awayTeam}`.toLowerCase();
        const matchB = `${b.homeTeam} vs ${b.awayTeam}`.toLowerCase();
        const byMatch = matchA.localeCompare(matchB);
        if (byMatch !== 0) return byMatch;
        const seqA = a.loopSequence ?? Number.MAX_SAFE_INTEGER;
        const seqB = b.loopSequence ?? Number.MAX_SAFE_INTEGER;
        if (seqA !== seqB) return seqA - seqB;
        return createdMs(a) - createdMs(b);
      }
      return createdMs(b) - createdMs(a);
    });

    return filtered;
  }, [sportsFlashMarkets, resolvedSearch, resolvedSort, statusFilter]);

  const visibleCryptoFlashMarkets = useMemo(() => {
    const rows = [...cryptoFlashMarkets];
    rows.sort((a, b) => {
      const ams = Date.parse(String(a.createdAt || ""));
      const bms = Date.parse(String(b.createdAt || ""));
      const safeA = Number.isFinite(ams) ? ams : 0;
      const safeB = Number.isFinite(bms) ? bms : 0;
      return safeB - safeA;
    });
    return rows;
  }, [cryptoFlashMarkets]);

  const resolvedTotalPages = useMemo(() => {
    if (statusFilter !== "resolved") return 1;
    return Math.max(1, Math.ceil(visibleFlashMarkets.length / RESOLVED_PAGE_SIZE));
  }, [statusFilter, visibleFlashMarkets.length]);

  const pagedFlashMarkets = useMemo(() => {
    if (statusFilter !== "resolved") return visibleFlashMarkets;
    const safePage = Math.min(Math.max(1, resolvedPage), resolvedTotalPages);
    const start = (safePage - 1) * RESOLVED_PAGE_SIZE;
    return visibleFlashMarkets.slice(start, start + RESOLVED_PAGE_SIZE);
  }, [statusFilter, visibleFlashMarkets, resolvedPage, resolvedTotalPages]);

  useEffect(() => {
    setResolvedPage(1);
  }, [statusFilter, resolvedSearch, resolvedSort]);

  useEffect(() => {
    if (statusFilter !== "resolved") return;
    if (resolvedPage > resolvedTotalPages) setResolvedPage(1);
  }, [statusFilter, resolvedPage, resolvedTotalPages]);

  const scrollToResolvedGridTop = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      desktopResolvedGridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    mobileResolvedGridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const goToPreviousResolvedPage = useCallback(() => {
    setResolvedPage((p) => Math.max(1, p - 1));
    requestAnimationFrame(scrollToResolvedGridTop);
  }, [scrollToResolvedGridTop]);

  const goToNextResolvedPage = useCallback(() => {
    setResolvedPage((p) => Math.min(resolvedTotalPages, p + 1));
    requestAnimationFrame(scrollToResolvedGridTop);
  }, [resolvedTotalPages, scrollToResolvedGridTop]);

  useEffect(() => {
    if (!q) {
      setSearchResults([]);
      return;
    }
    void performSearch(q);
  }, [q]);

  async function performSearch(searchQuery: string) {
    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from("markets")
        .select(
          "market_address,question,category,image_url,market_type,total_volume,end_date,resolution_status,yes_supply,no_supply,outcome_supplies",
        )
        .or(`question.ilike.%${searchQuery}%,category.ilike.%${searchQuery}%,creator.ilike.%${searchQuery}%`)
        .order("total_volume", { ascending: false })
        .limit(30);

      if (error) throw error;
      setSearchResults((data as Market[]) || []);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  const isSearchMode = q.length > 0;

  return (
    <div className="min-h-screen bg-black pb-20">
      <div className="max-w-7xl mx-auto px-4 py-4 space-y-8">
        {isSearchMode && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-lg font-semibold text-white">
                Results for &quot;<span className="text-[#61ff9a]">{q}</span>&quot;
              </h1>
              <span className="text-sm text-gray-500">{searchResults.length} markets</span>
            </div>

            {searchLoading ? (
              <LoadingSpinner />
            ) : searchResults.length === 0 ? (
              <EmptyState message="No markets found" subtitle="Try different keywords" />
            ) : (
              <div className="space-y-2">
                {searchResults.map((market) => (
                  <MarketRow key={market.market_address} market={market} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Desktop-only flash system layout */}
        <div className="hidden md:block space-y-10">
          <section>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-white">⚽ Flash Markets — Sports</h2>
                <p className="text-sm text-gray-400">Live quick markets, updated for instant decisions.</p>
              </div>
            </div>

            <div className="mb-4 flex items-center gap-2">
              <FilterPill
                label="Open"
                active={statusFilter === "open"}
                onClick={() => setStatusFilter("open")}
              />
              <FilterPill
                label="Resolved"
                active={statusFilter === "resolved"}
                onClick={() => setStatusFilter("resolved")}
              />
            </div>

            {statusFilter === "resolved" && (
              <div className="mb-4 flex items-center gap-2">
                <input
                  type="text"
                  value={resolvedSearch}
                  onChange={(e) => setResolvedSearch(e.target.value)}
                  placeholder="Search by match, team, question, window..."
                  className="w-full max-w-[360px] rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                />
                <select
                  value={resolvedSort}
                  onChange={(e) => setResolvedSort(e.target.value as ResolvedSort)}
                  className="w-[220px] rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="match">Group by match</option>
                </select>
              </div>
            )}

            {sportsFlashLoading ? (
              <LoadingSpinner />
            ) : visibleFlashMarkets.length === 0 ? (
              <PremiumFlashEmptyState
                title={
                  statusFilter === "resolved"
                    ? "No resolved sports flash markets right now"
                    : "No live sports flash session right now"
                }
                subtitle={
                  statusFilter === "resolved"
                    ? "Next sports flash session soon"
                    : "Check back in a few minutes"
                }
              />
            ) : (
              <>
                <div ref={desktopResolvedGridTopRef} />
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {pagedFlashMarkets.map((market) => (
                    <FlashMarketCard key={market.liveMicroId} market={market} />
                  ))}
                </div>
                {statusFilter === "resolved" && (
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={goToPreviousResolvedPage}
                      disabled={resolvedPage <= 1}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium text-white transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="tabular-nums text-sm text-gray-300">
                      Page {Math.min(resolvedPage, resolvedTotalPages)} / {resolvedTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={goToNextResolvedPage}
                      disabled={resolvedPage >= resolvedTotalPages}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium text-white transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-white">⚡ Flash Markets — Crypto</h2>
                <p className="text-sm text-gray-400">Fast crypto flash sessions, tuned for live momentum.</p>
              </div>
            </div>

            <div className="mb-4 flex items-center gap-2">
              <FilterPill
                label="Open"
                active={cryptoStatusFilter === "open"}
                onClick={() => setCryptoStatusFilter("open")}
              />
              <FilterPill
                label="Resolved"
                active={cryptoStatusFilter === "resolved"}
                onClick={() => setCryptoStatusFilter("resolved")}
              />
            </div>

            {cryptoFlashLoading ? (
              <LoadingSpinner />
            ) : visibleCryptoFlashMarkets.length === 0 ? (
              <PremiumFlashEmptyState
                title={
                  cryptoStatusFilter === "resolved"
                    ? "No resolved crypto flash markets right now"
                    : "No live crypto flash session right now"
                }
                subtitle={
                  cryptoStatusFilter === "resolved"
                    ? "Resolved crypto flash markets will appear here soon"
                    : "Crypto flash sessions start soon"
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {visibleCryptoFlashMarkets.map((market) => (
                  <FlashMarketCard key={market.liveMicroId} market={market} />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-white">📍 Flash Markets — IRL</h2>
                <p className="text-sm text-gray-400">Real-world flash windows, ready for quick market action.</p>
              </div>
            </div>

            <div className="mb-4 flex items-center gap-2">
              <FilterPill
                label="Open"
                active={irlStatusFilter === "open"}
                onClick={() => setIrlStatusFilter("open")}
              />
              <FilterPill
                label="Resolved"
                active={irlStatusFilter === "resolved"}
                onClick={() => setIrlStatusFilter("resolved")}
              />
            </div>

            <PremiumFlashEmptyState
              title={
                irlStatusFilter === "resolved"
                  ? "No resolved IRL flash markets right now"
                  : "No live IRL flash session right now"
              }
              subtitle={
                irlStatusFilter === "resolved"
                  ? "Resolved IRL flash markets will appear here soon"
                  : "IRL flash sessions start soon"
              }
            />
          </section>
        </div>

        {/* Mobile flash sections */}
        <div className="space-y-8 md:hidden">
          <section>
            <div className="flex items-end justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">⚽ Flash Markets — Sports</h2>
                <p className="mt-1 text-sm text-gray-400">Live quick markets, updated for instant decisions.</p>
              </div>
            </div>

            {/* ── Filter pills ── */}
            <div className="mb-4 flex items-center gap-2">
              <FilterPill
                label="Open"
                active={statusFilter === "open"}
                onClick={() => setStatusFilter("open")}
              />
              <FilterPill
                label="Resolved"
                active={statusFilter === "resolved"}
                onClick={() => setStatusFilter("resolved")}
              />
            </div>

            {statusFilter === "resolved" && (
              <div className="mb-4 flex flex-col gap-2">
                <input
                  type="text"
                  value={resolvedSearch}
                  onChange={(e) => setResolvedSearch(e.target.value)}
                  placeholder="Search by match, team, question, window..."
                  className="w-full rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                />
                <select
                  value={resolvedSort}
                  onChange={(e) => setResolvedSort(e.target.value as ResolvedSort)}
                  className="w-full rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="match">Group by match</option>
                </select>
              </div>
            )}

            {sportsFlashLoading ? (
              <LoadingSpinner />
            ) : visibleFlashMarkets.length === 0 ? (
              <PremiumFlashEmptyState
                compact
                title={
                  statusFilter === "resolved"
                    ? "No resolved sports flash markets right now"
                    : "No live sports flash session right now"
                }
                subtitle={
                  statusFilter === "resolved"
                    ? "Next sports flash session soon"
                    : "Check back in a few minutes"
                }
              />
            ) : (
              <>
                <div ref={mobileResolvedGridTopRef} />
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {pagedFlashMarkets.map((market) => (
                    <FlashMarketCard key={market.liveMicroId} market={market} />
                  ))}
                </div>
                {statusFilter === "resolved" && (
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={goToPreviousResolvedPage}
                      disabled={resolvedPage <= 1}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium border border-white/15 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:border-white/30 transition"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-300 tabular-nums">
                      Page {Math.min(resolvedPage, resolvedTotalPages)} / {resolvedTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={goToNextResolvedPage}
                      disabled={resolvedPage >= resolvedTotalPages}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium border border-white/15 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:border-white/30 transition"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-white">⚡ Flash Markets — Crypto</h2>
                <p className="mt-1 text-sm text-gray-400">Fast crypto flash sessions, tuned for live momentum.</p>
              </div>
            </div>

            <div className="mb-4 flex items-center gap-2">
              <FilterPill
                label="Open"
                active={cryptoStatusFilter === "open"}
                onClick={() => setCryptoStatusFilter("open")}
              />
              <FilterPill
                label="Resolved"
                active={cryptoStatusFilter === "resolved"}
                onClick={() => setCryptoStatusFilter("resolved")}
              />
            </div>

            {cryptoFlashLoading ? (
              <LoadingSpinner />
            ) : visibleCryptoFlashMarkets.length === 0 ? (
              <PremiumFlashEmptyState
                compact
                title={
                  cryptoStatusFilter === "resolved"
                    ? "No resolved crypto flash markets right now"
                    : "No live crypto flash session right now"
                }
                subtitle={
                  cryptoStatusFilter === "resolved"
                    ? "Resolved crypto flash markets will appear here soon"
                    : "Crypto flash sessions start soon"
                }
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {visibleCryptoFlashMarkets.map((market) => (
                  <FlashMarketCard key={market.liveMicroId} market={market} />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-white">📍 Flash Markets — IRL</h2>
                <p className="mt-1 text-sm text-gray-400">Real-world flash windows, ready for quick market action.</p>
              </div>
            </div>

            <div className="mb-4 flex items-center gap-2">
              <FilterPill
                label="Open"
                active={irlStatusFilter === "open"}
                onClick={() => setIrlStatusFilter("open")}
              />
              <FilterPill
                label="Resolved"
                active={irlStatusFilter === "resolved"}
                onClick={() => setIrlStatusFilter("resolved")}
              />
            </div>

            <PremiumFlashEmptyState
              compact
              title={
                irlStatusFilter === "resolved"
                  ? "No resolved IRL flash markets right now"
                  : "No live IRL flash session right now"
              }
              subtitle={
                irlStatusFilter === "resolved"
                  ? "Resolved IRL flash markets will appear here soon"
                  : "IRL flash sessions start soon"
              }
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
        active
          ? "bg-[#61ff9a] text-black"
          : "bg-white/8 text-gray-400 hover:bg-white/12 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function MarketRow({ market }: { market: Market }) {
  const pct = marketTopPct(market);
  const vol = lamportsToSol(Number(market.total_volume) || 0).toFixed(2);

  return (
    <Link
      href={`/trade/${market.market_address}`}
      className="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#0a0a0a] p-3 hover:border-[#61ff9a]/60 transition"
    >
      <div className="h-10 w-10 rounded-lg overflow-hidden bg-black shrink-0 flex items-center justify-center">
        {market.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={market.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="text-gray-600 text-lg">?</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white truncate">{market.question}</div>
        <div className="text-xs text-gray-500 truncate">
          {(market.category || "other").toString()} • {vol} SOL
        </div>
      </div>

      <div className="text-sm font-bold text-[#61ff9a] tabular-nums">{pct}%</div>
    </Link>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-[#61ff9a] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function PremiumFlashEmptyState({
  title,
  subtitle,
  compact = false,
}: {
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#0b0f0c] to-[#070908] ${
        compact ? "py-9" : "py-14"
      }`}
    >
      <div className="mx-auto flex w-full max-w-lg flex-col items-center px-6 text-center">
        <div
          className={`mb-4 flex items-center justify-center rounded-2xl border border-pump-green/30 bg-pump-green/10 shadow-[0_0_36px_rgba(97,255,154,0.18)] animate-pulse ${
            compact ? "h-12 w-12" : "h-16 w-16"
          }`}
        >
          <Zap className={`${compact ? "h-5 w-5" : "h-7 w-7"} text-pump-green`} />
        </div>
        <p className="text-base font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyState({ message, subtitle }: { message: string; subtitle: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-gray-400 font-medium">{message}</p>
      <p className="text-gray-600 text-sm mt-1">{subtitle}</p>
    </div>
  );
}
