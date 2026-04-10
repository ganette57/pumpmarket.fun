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
type ChronoSort = "newest" | "oldest";
type CryptoSourceFilter = "all" | "pump_fun" | "major";
type CryptoTokenQuickFilter = "all" | "btc" | "sol" | "eth" | "bnb";
const RESOLVED_PAGE_SIZE = 28;

function createInitialResolvedPages(): Record<FlashMarketKind, number> {
  return {
    sport: 1,
    crypto: 1,
    irl: 1,
  };
}

function createdAtMs(market: FlashMarket): number {
  const parsed = Date.parse(String(market.createdAt || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortByCreatedAtDesc(rows: FlashMarket[]): FlashMarket[] {
  const next = [...rows];
  next.sort((a, b) => createdAtMs(b) - createdAtMs(a));
  return next;
}

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

function sliceForPage(rows: FlashMarket[], page: number, totalPages: number): FlashMarket[] {
  const safePage = clampPage(page, totalPages);
  const start = (safePage - 1) * RESOLVED_PAGE_SIZE;
  return rows.slice(start, start + RESOLVED_PAGE_SIZE);
}

function normalizeText(input: string | null | undefined): string {
  return String(input || "").trim().toLowerCase();
}

export default function ExplorerPage() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";

  const [searchResults, setSearchResults] = useState<Market[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [sportsFlashMarkets, setSportsFlashMarkets] = useState<FlashMarket[]>([]);
  const [sportsFlashLoading, setSportsFlashLoading] = useState(true);
  const [cryptoFlashMarkets, setCryptoFlashMarkets] = useState<FlashMarket[]>([]);
  const [cryptoFlashLoading, setCryptoFlashLoading] = useState(true);
  const [irlFlashMarkets, setIrlFlashMarkets] = useState<FlashMarket[]>([]);
  const [irlFlashLoading, setIrlFlashLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [resolvedKind, setResolvedKind] = useState<FlashMarketKind>("sport");
  const [resolvedSearch, setResolvedSearch] = useState("");
  const [resolvedSort, setResolvedSort] = useState<ResolvedSort>("newest");
  const [cryptoResolvedSearch, setCryptoResolvedSearch] = useState("");
  const [cryptoResolvedSort, setCryptoResolvedSort] = useState<ChronoSort>("newest");
  const [cryptoResolvedSource, setCryptoResolvedSource] = useState<CryptoSourceFilter>("all");
  const [cryptoResolvedToken, setCryptoResolvedToken] = useState<CryptoTokenQuickFilter>("all");
  const [irlResolvedSearch, setIrlResolvedSearch] = useState("");
  const [irlResolvedSort, setIrlResolvedSort] = useState<ChronoSort>("newest");
  const [irlResolvedCamera, setIrlResolvedCamera] = useState("all");
  const [resolvedPageByKind, setResolvedPageByKind] = useState<Record<FlashMarketKind, number>>(
    createInitialResolvedPages(),
  );
  const desktopResolvedGridTopRef = useRef<HTMLDivElement | null>(null);
  const mobileResolvedGridTopRef = useRef<HTMLDivElement | null>(null);

  const fetchFlashMarkets = useCallback(async (kind: FlashMarketKind, filter: StatusFilter) => {
    if (kind === "sport") setSportsFlashLoading(true);
    if (kind === "crypto") setCryptoFlashLoading(true);
    if (kind === "irl") setIrlFlashLoading(true);
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
      if (kind === "irl") setIrlFlashMarkets(rows);
    } catch (error) {
      console.warn(`Flash ${kind} markets fetch failed:`, error);
      if (kind === "sport") setSportsFlashMarkets([]);
      if (kind === "crypto") setCryptoFlashMarkets([]);
      if (kind === "irl") setIrlFlashMarkets([]);
    } finally {
      if (kind === "sport") setSportsFlashLoading(false);
      if (kind === "crypto") setCryptoFlashLoading(false);
      if (kind === "irl") setIrlFlashLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      fetchFlashMarkets("sport", statusFilter),
      fetchFlashMarkets("crypto", statusFilter),
      fetchFlashMarkets("irl", statusFilter),
    ]);
  }, [statusFilter, fetchFlashMarkets]);

  const visibleSportsFlashMarkets = useMemo(() => {
    if (statusFilter !== "resolved") return sportsFlashMarkets;
    const normalizedQuery = resolvedSearch.trim().toLowerCase();
    const filtered = normalizedQuery
      ? sportsFlashMarkets.filter((m) => {
          const match = `${m.homeTeam} vs ${m.awayTeam}`.toLowerCase();
          const question = String(m.question || "").toLowerCase();
          const windowLabel = m.loopSequence != null ? `window #${m.loopSequence}` : "";
          return (
            match.includes(normalizedQuery) ||
            question.includes(normalizedQuery) ||
            String(m.homeTeam || "").toLowerCase().includes(normalizedQuery) ||
            String(m.awayTeam || "").toLowerCase().includes(normalizedQuery) ||
            windowLabel.includes(normalizedQuery)
          );
        })
      : [...sportsFlashMarkets];

    filtered.sort((a, b) => {
      if (resolvedSort === "oldest") return createdAtMs(a) - createdAtMs(b);
      if (resolvedSort === "match") {
        const matchA = `${a.homeTeam} vs ${a.awayTeam}`.toLowerCase();
        const matchB = `${b.homeTeam} vs ${b.awayTeam}`.toLowerCase();
        const byMatch = matchA.localeCompare(matchB);
        if (byMatch !== 0) return byMatch;
        const seqA = a.loopSequence ?? Number.MAX_SAFE_INTEGER;
        const seqB = b.loopSequence ?? Number.MAX_SAFE_INTEGER;
        if (seqA !== seqB) return seqA - seqB;
        return createdAtMs(a) - createdAtMs(b);
      }
      return createdAtMs(b) - createdAtMs(a);
    });

    return filtered;
  }, [sportsFlashMarkets, resolvedSearch, resolvedSort, statusFilter]);

  const visibleCryptoFlashMarkets = useMemo(() => {
    const rows = sortByCreatedAtDesc(cryptoFlashMarkets);
    if (statusFilter !== "resolved") return rows;

    const normalizedQuery = normalizeText(cryptoResolvedSearch);
    const bySearch = normalizedQuery
      ? rows.filter((m) => {
          const tokenSymbol = normalizeText(m.tokenSymbol);
          const question = normalizeText(m.question);
          const providerSource = normalizeText(m.providerSource || m.providerName);
          const sourceType = normalizeText(m.cryptoSourceType);
          return (
            tokenSymbol.includes(normalizedQuery) ||
            question.includes(normalizedQuery) ||
            providerSource.includes(normalizedQuery) ||
            sourceType.includes(normalizedQuery)
          );
        })
      : rows;

    const bySource =
      cryptoResolvedSource === "all"
        ? bySearch
        : bySearch.filter((m) => normalizeText(m.cryptoSourceType) === cryptoResolvedSource);

    const byToken =
      cryptoResolvedToken === "all"
        ? bySource
        : bySource.filter((m) => normalizeText(m.tokenSymbol) === cryptoResolvedToken);

    byToken.sort((a, b) => {
      if (cryptoResolvedSort === "oldest") return createdAtMs(a) - createdAtMs(b);
      return createdAtMs(b) - createdAtMs(a);
    });
    return byToken;
  }, [cryptoFlashMarkets, statusFilter, cryptoResolvedSearch, cryptoResolvedSort, cryptoResolvedSource, cryptoResolvedToken]);

  const visibleIrlFlashMarkets = useMemo(() => {
    const rows = sortByCreatedAtDesc(irlFlashMarkets);
    if (statusFilter !== "resolved") return rows;

    const normalizedQuery = normalizeText(irlResolvedSearch);
    const bySearch = normalizedQuery
      ? rows.filter((m) => {
          const cameraName = normalizeText(m.league || m.providerMatchId);
          const question = normalizeText(m.question);
          return cameraName.includes(normalizedQuery) || question.includes(normalizedQuery);
        })
      : rows;

    const byCamera =
      irlResolvedCamera === "all"
        ? bySearch
        : bySearch.filter((m) => normalizeText(m.league || m.providerMatchId) === irlResolvedCamera);

    byCamera.sort((a, b) => {
      if (irlResolvedSort === "oldest") return createdAtMs(a) - createdAtMs(b);
      return createdAtMs(b) - createdAtMs(a);
    });
    return byCamera;
  }, [irlFlashMarkets, statusFilter, irlResolvedSearch, irlResolvedSort, irlResolvedCamera]);

  const irlResolvedCameraOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const market of irlFlashMarkets) {
      const camera = normalizeText(market.league || market.providerMatchId);
      if (camera) unique.add(camera);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [irlFlashMarkets]);

  const resolvedTotalPagesByKind = useMemo(
    () => ({
      sport: Math.max(1, Math.ceil(visibleSportsFlashMarkets.length / RESOLVED_PAGE_SIZE)),
      crypto: Math.max(1, Math.ceil(visibleCryptoFlashMarkets.length / RESOLVED_PAGE_SIZE)),
      irl: Math.max(1, Math.ceil(visibleIrlFlashMarkets.length / RESOLVED_PAGE_SIZE)),
    }),
    [visibleSportsFlashMarkets.length, visibleCryptoFlashMarkets.length, visibleIrlFlashMarkets.length],
  );

  const pagedSportsFlashMarkets = useMemo(
    () =>
      statusFilter === "resolved"
        ? sliceForPage(visibleSportsFlashMarkets, resolvedPageByKind.sport, resolvedTotalPagesByKind.sport)
        : visibleSportsFlashMarkets,
    [statusFilter, visibleSportsFlashMarkets, resolvedPageByKind.sport, resolvedTotalPagesByKind.sport],
  );

  const pagedCryptoFlashMarkets = useMemo(
    () =>
      statusFilter === "resolved"
        ? sliceForPage(visibleCryptoFlashMarkets, resolvedPageByKind.crypto, resolvedTotalPagesByKind.crypto)
        : visibleCryptoFlashMarkets,
    [statusFilter, visibleCryptoFlashMarkets, resolvedPageByKind.crypto, resolvedTotalPagesByKind.crypto],
  );

  const pagedIrlFlashMarkets = useMemo(
    () =>
      statusFilter === "resolved"
        ? sliceForPage(visibleIrlFlashMarkets, resolvedPageByKind.irl, resolvedTotalPagesByKind.irl)
        : visibleIrlFlashMarkets,
    [statusFilter, visibleIrlFlashMarkets, resolvedPageByKind.irl, resolvedTotalPagesByKind.irl],
  );

  useEffect(() => {
    setResolvedPageByKind(createInitialResolvedPages());
  }, [statusFilter]);

  useEffect(() => {
    setResolvedPageByKind((prev) => ({ ...prev, sport: 1 }));
  }, [resolvedSearch, resolvedSort]);

  useEffect(() => {
    setResolvedPageByKind((prev) => ({ ...prev, crypto: 1 }));
  }, [cryptoResolvedSearch, cryptoResolvedSort, cryptoResolvedSource, cryptoResolvedToken]);

  useEffect(() => {
    setResolvedPageByKind((prev) => ({ ...prev, irl: 1 }));
  }, [irlResolvedSearch, irlResolvedSort, irlResolvedCamera]);

  useEffect(() => {
    setResolvedPageByKind((prev) => {
      const next = {
        sport: clampPage(prev.sport, resolvedTotalPagesByKind.sport),
        crypto: clampPage(prev.crypto, resolvedTotalPagesByKind.crypto),
        irl: clampPage(prev.irl, resolvedTotalPagesByKind.irl),
      };
      if (next.sport === prev.sport && next.crypto === prev.crypto && next.irl === prev.irl) {
        return prev;
      }
      return next;
    });
  }, [resolvedTotalPagesByKind.sport, resolvedTotalPagesByKind.crypto, resolvedTotalPagesByKind.irl]);

  const activeResolvedMarkets = useMemo(() => {
    if (resolvedKind === "sport") return pagedSportsFlashMarkets;
    if (resolvedKind === "crypto") return pagedCryptoFlashMarkets;
    return pagedIrlFlashMarkets;
  }, [resolvedKind, pagedSportsFlashMarkets, pagedCryptoFlashMarkets, pagedIrlFlashMarkets]);

  const activeResolvedLoading = useMemo(() => {
    if (resolvedKind === "sport") return sportsFlashLoading;
    if (resolvedKind === "crypto") return cryptoFlashLoading;
    return irlFlashLoading;
  }, [resolvedKind, sportsFlashLoading, cryptoFlashLoading, irlFlashLoading]);

  const activeResolvedTotalPages = resolvedTotalPagesByKind[resolvedKind];
  const activeResolvedPage = clampPage(resolvedPageByKind[resolvedKind], activeResolvedTotalPages);

  const openResolvedFrom = useCallback((kind: FlashMarketKind) => {
    setResolvedKind(kind);
    setStatusFilter("resolved");
  }, []);

  const scrollToResolvedGridTop = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      desktopResolvedGridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    mobileResolvedGridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const goToPreviousResolvedPage = useCallback(() => {
    setResolvedPageByKind((prev) => ({
      ...prev,
      [resolvedKind]: Math.max(1, prev[resolvedKind] - 1),
    }));
    requestAnimationFrame(scrollToResolvedGridTop);
  }, [resolvedKind, scrollToResolvedGridTop]);

  const goToNextResolvedPage = useCallback(() => {
    setResolvedPageByKind((prev) => ({
      ...prev,
      [resolvedKind]: Math.min(activeResolvedTotalPages, prev[resolvedKind] + 1),
    }));
    requestAnimationFrame(scrollToResolvedGridTop);
  }, [resolvedKind, activeResolvedTotalPages, scrollToResolvedGridTop]);

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
  const resolvedDesktopTitle =
    resolvedKind === "sport"
      ? "⚽ Flash Markets — Sports"
      : resolvedKind === "crypto"
        ? "⚡ Flash Markets — Crypto"
        : "📍 Flash Markets — IRL";
  const resolvedMobileTitle =
    resolvedKind === "sport" ? "Sports Resolved" : resolvedKind === "crypto" ? "Crypto Resolved" : "IRL Resolved";
  const resolvedEmptyTitle =
    resolvedKind === "sport"
      ? "No resolved sports flash markets right now"
      : resolvedKind === "crypto"
        ? "No resolved crypto flash markets right now"
        : "No resolved IRL flash markets right now";
  const resolvedEmptySubtitle =
    resolvedKind === "sport"
      ? "Next sports flash session soon"
      : resolvedKind === "crypto"
        ? "Resolved crypto flash markets will appear here soon"
        : "Resolved IRL flash markets will appear here soon";

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

        {/* Desktop flash layout */}
        <div className="hidden md:block space-y-10">
          {statusFilter === "open" ? (
            <>
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
                    active
                    onClick={() => setStatusFilter("open")}
                  />
                  <FilterPill
                    label="Resolved"
                    active={false}
                    onClick={() => openResolvedFrom("sport")}
                  />
                </div>

                {sportsFlashLoading ? (
                  <LoadingSpinner />
                ) : visibleSportsFlashMarkets.length === 0 ? (
                  <PremiumFlashEmptyState
                    title="No live sports flash session right now"
                    subtitle="Check back in a few minutes"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {visibleSportsFlashMarkets.map((market) => (
                      <FlashMarketCard key={market.liveMicroId} market={market} />
                    ))}
                  </div>
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
                    active
                    onClick={() => setStatusFilter("open")}
                  />
                  <FilterPill
                    label="Resolved"
                    active={false}
                    onClick={() => openResolvedFrom("crypto")}
                  />
                </div>

                {cryptoFlashLoading ? (
                  <LoadingSpinner />
                ) : visibleCryptoFlashMarkets.length === 0 ? (
                  <PremiumFlashEmptyState
                    title="No live crypto flash session right now"
                    subtitle="Crypto flash sessions start soon"
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
                    active
                    onClick={() => setStatusFilter("open")}
                  />
                  <FilterPill
                    label="Resolved"
                    active={false}
                    onClick={() => openResolvedFrom("irl")}
                  />
                </div>

                {irlFlashLoading ? (
                  <LoadingSpinner />
                ) : visibleIrlFlashMarkets.length === 0 ? (
                  <PremiumFlashEmptyState
                    title="No live IRL flash session right now"
                    subtitle="IRL flash sessions start soon"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {visibleIrlFlashMarkets.map((market) => (
                      <FlashMarketCard key={market.liveMicroId} market={market} />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <section>
              <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-white">{resolvedDesktopTitle}</h2>
                  <p className="text-sm text-gray-400">Browse resolved flash markets by stream without long scrolling.</p>
                </div>
              </div>

              <div className="mb-4 flex items-center gap-2">
                <FilterPill
                  label="Open"
                  active={false}
                  onClick={() => setStatusFilter("open")}
                />
                <FilterPill
                  label="Resolved"
                  active
                  onClick={() => setStatusFilter("resolved")}
                />
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <FilterPill
                  label="Sports"
                  active={resolvedKind === "sport"}
                  onClick={() => setResolvedKind("sport")}
                />
                <FilterPill
                  label="Crypto"
                  active={resolvedKind === "crypto"}
                  onClick={() => setResolvedKind("crypto")}
                />
                <FilterPill
                  label="IRL"
                  active={resolvedKind === "irl"}
                  onClick={() => setResolvedKind("irl")}
                />
              </div>

              {resolvedKind === "sport" && (
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
              {resolvedKind === "crypto" && (
                <div className="mb-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <FilterPill label="All" active={cryptoResolvedToken === "all"} onClick={() => setCryptoResolvedToken("all")} />
                    <FilterPill label="BTC" active={cryptoResolvedToken === "btc"} onClick={() => setCryptoResolvedToken("btc")} />
                    <FilterPill label="SOL" active={cryptoResolvedToken === "sol"} onClick={() => setCryptoResolvedToken("sol")} />
                    <FilterPill label="ETH" active={cryptoResolvedToken === "eth"} onClick={() => setCryptoResolvedToken("eth")} />
                    <FilterPill label="BNB" active={cryptoResolvedToken === "bnb"} onClick={() => setCryptoResolvedToken("bnb")} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={cryptoResolvedSearch}
                      onChange={(e) => setCryptoResolvedSearch(e.target.value)}
                      placeholder="Search token, question, source..."
                      className="w-full max-w-[320px] rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                    />
                    <select
                      value={cryptoResolvedSort}
                      onChange={(e) => setCryptoResolvedSort(e.target.value as ChronoSort)}
                      className="w-[180px] rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                    <select
                      value={cryptoResolvedSource}
                      onChange={(e) => setCryptoResolvedSource(e.target.value as CryptoSourceFilter)}
                      className="w-[160px] rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                    >
                      <option value="all">All sources</option>
                      <option value="pump_fun">Pump.fun</option>
                      <option value="major">Majors</option>
                    </select>
                  </div>
                </div>
              )}
              {resolvedKind === "irl" && (
                <div className="mb-4 flex items-center gap-2">
                  <input
                    type="text"
                    value={irlResolvedSearch}
                    onChange={(e) => setIrlResolvedSearch(e.target.value)}
                    placeholder="Search camera or question..."
                    className="w-full max-w-[320px] rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                  />
                  <select
                    value={irlResolvedSort}
                    onChange={(e) => setIrlResolvedSort(e.target.value as ChronoSort)}
                    className="w-[180px] rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </select>
                  <select
                    value={irlResolvedCamera}
                    onChange={(e) => setIrlResolvedCamera(e.target.value)}
                    className="w-[220px] rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                  >
                    <option value="all">All cameras</option>
                    {irlResolvedCameraOptions.map((camera) => (
                      <option key={camera} value={camera}>
                        {camera}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeResolvedLoading ? (
                <LoadingSpinner />
              ) : activeResolvedMarkets.length === 0 ? (
                <PremiumFlashEmptyState title={resolvedEmptyTitle} subtitle={resolvedEmptySubtitle} />
              ) : (
                <>
                  <div ref={desktopResolvedGridTopRef} />
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {activeResolvedMarkets.map((market) => (
                      <FlashMarketCard key={market.liveMicroId} market={market} />
                    ))}
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={goToPreviousResolvedPage}
                      disabled={activeResolvedPage <= 1}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium text-white transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="tabular-nums text-sm text-gray-300">
                      Page {activeResolvedPage} / {activeResolvedTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={goToNextResolvedPage}
                      disabled={activeResolvedPage >= activeResolvedTotalPages}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium text-white transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>

        {/* Mobile flash layout */}
        <div className="space-y-8 md:hidden">
          {statusFilter === "open" ? (
            <>
              <section>
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-white">⚽ Flash Markets — Sports</h2>
                    <p className="mt-1 text-sm text-gray-400">Live quick markets, updated for instant decisions.</p>
                  </div>
                </div>

                <div className="mb-4 flex items-center gap-2">
                  <FilterPill
                    label="Open"
                    active
                    onClick={() => setStatusFilter("open")}
                  />
                  <FilterPill
                    label="Resolved"
                    active={false}
                    onClick={() => openResolvedFrom("sport")}
                  />
                </div>

                {sportsFlashLoading ? (
                  <LoadingSpinner />
                ) : visibleSportsFlashMarkets.length === 0 ? (
                  <PremiumFlashEmptyState
                    compact
                    title="No live sports flash session right now"
                    subtitle="Check back in a few minutes"
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {visibleSportsFlashMarkets.map((market) => (
                      <FlashMarketCard key={market.liveMicroId} market={market} />
                    ))}
                  </div>
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
                    active
                    onClick={() => setStatusFilter("open")}
                  />
                  <FilterPill
                    label="Resolved"
                    active={false}
                    onClick={() => openResolvedFrom("crypto")}
                  />
                </div>

                {cryptoFlashLoading ? (
                  <LoadingSpinner />
                ) : visibleCryptoFlashMarkets.length === 0 ? (
                  <PremiumFlashEmptyState
                    compact
                    title="No live crypto flash session right now"
                    subtitle="Crypto flash sessions start soon"
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
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
                    active
                    onClick={() => setStatusFilter("open")}
                  />
                  <FilterPill
                    label="Resolved"
                    active={false}
                    onClick={() => openResolvedFrom("irl")}
                  />
                </div>

                {irlFlashLoading ? (
                  <LoadingSpinner />
                ) : visibleIrlFlashMarkets.length === 0 ? (
                  <PremiumFlashEmptyState
                    compact
                    title="No live IRL flash session right now"
                    subtitle="IRL flash sessions start soon"
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {visibleIrlFlashMarkets.map((market) => (
                      <FlashMarketCard key={market.liveMicroId} market={market} />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <section>
              <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-white">Flash Markets — {resolvedMobileTitle}</h2>
                  <p className="mt-1 text-sm text-gray-400">One resolved stream at a time for faster mobile browsing.</p>
                </div>
              </div>

              <div className="mb-4 flex items-center gap-2">
                <FilterPill
                  label="Open"
                  active={false}
                  onClick={() => setStatusFilter("open")}
                />
                <FilterPill
                  label="Resolved"
                  active
                  onClick={() => setStatusFilter("resolved")}
                />
              </div>

              <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
                <FilterPill
                  label="Sports"
                  active={resolvedKind === "sport"}
                  onClick={() => setResolvedKind("sport")}
                />
                <FilterPill
                  label="Crypto"
                  active={resolvedKind === "crypto"}
                  onClick={() => setResolvedKind("crypto")}
                />
                <FilterPill
                  label="IRL"
                  active={resolvedKind === "irl"}
                  onClick={() => setResolvedKind("irl")}
                />
              </div>

              {resolvedKind === "sport" && (
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
              {resolvedKind === "crypto" && (
                <div className="mb-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    <FilterPill label="All" active={cryptoResolvedToken === "all"} onClick={() => setCryptoResolvedToken("all")} />
                    <FilterPill label="BTC" active={cryptoResolvedToken === "btc"} onClick={() => setCryptoResolvedToken("btc")} />
                    <FilterPill label="SOL" active={cryptoResolvedToken === "sol"} onClick={() => setCryptoResolvedToken("sol")} />
                    <FilterPill label="ETH" active={cryptoResolvedToken === "eth"} onClick={() => setCryptoResolvedToken("eth")} />
                    <FilterPill label="BNB" active={cryptoResolvedToken === "bnb"} onClick={() => setCryptoResolvedToken("bnb")} />
                  </div>
                  <input
                    type="text"
                    value={cryptoResolvedSearch}
                    onChange={(e) => setCryptoResolvedSearch(e.target.value)}
                    placeholder="Search token, question, source..."
                    className="w-full rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      value={cryptoResolvedSort}
                      onChange={(e) => setCryptoResolvedSort(e.target.value as ChronoSort)}
                      className="w-full rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                    <select
                      value={cryptoResolvedSource}
                      onChange={(e) => setCryptoResolvedSource(e.target.value as CryptoSourceFilter)}
                      className="w-full rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                    >
                      <option value="all">All sources</option>
                      <option value="pump_fun">Pump.fun</option>
                      <option value="major">Majors</option>
                    </select>
                  </div>
                </div>
              )}
              {resolvedKind === "irl" && (
                <div className="mb-4 flex flex-col gap-2">
                  <input
                    type="text"
                    value={irlResolvedSearch}
                    onChange={(e) => setIrlResolvedSearch(e.target.value)}
                    placeholder="Search camera or question..."
                    className="w-full rounded-lg border border-white/20 bg-white/95 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      value={irlResolvedSort}
                      onChange={(e) => setIrlResolvedSort(e.target.value as ChronoSort)}
                      className="w-full rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                    <select
                      value={irlResolvedCamera}
                      onChange={(e) => setIrlResolvedCamera(e.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#61ff9a]"
                    >
                      <option value="all">All cameras</option>
                      {irlResolvedCameraOptions.map((camera) => (
                        <option key={camera} value={camera}>
                          {camera}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {activeResolvedLoading ? (
                <LoadingSpinner />
              ) : activeResolvedMarkets.length === 0 ? (
                <PremiumFlashEmptyState compact title={resolvedEmptyTitle} subtitle={resolvedEmptySubtitle} />
              ) : (
                <>
                  <div ref={mobileResolvedGridTopRef} />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {activeResolvedMarkets.map((market) => (
                      <FlashMarketCard key={market.liveMicroId} market={market} />
                    ))}
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={goToPreviousResolvedPage}
                      disabled={activeResolvedPage <= 1}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium text-white transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="tabular-nums text-sm text-gray-300">
                      Page {activeResolvedPage} / {activeResolvedTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={goToNextResolvedPage}
                      disabled={activeResolvedPage >= activeResolvedTotalPages}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium text-white transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
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
