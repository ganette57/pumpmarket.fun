// src/app/search/page.tsx
// Full mobile search/browse page — complete old Home mobile experience.
// Carousel, category filters, status filters, market cards, infinite scroll.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronDown } from "lucide-react";
import MarketCard from "@/components/MarketCard";
import FeaturedMarketCardFull from "@/components/FeaturedMarketCardFull";
import FlashMarketCard from "@/components/FlashMarketCard";
import CategoryFilters from "@/components/CategoryFilters";
import type { SelectedCategory } from "@/components/CategoryFilters";
import { SkeletonCard, SkeletonFeaturedCard } from "@/components/SkeletonCard";
import { isSportSubcategory } from "@/utils/categories";
import { getProfiles, type Profile } from "@/lib/profiles";
import type { FlashMarket } from "@/lib/flashMarkets/types";

/* ── Types ─────────────────────────────────────────────────────────── */

type Market = {
  id?: string;
  publicKey: string;
  question: string;
  description: string;
  category: string;
  imageUrl?: string | null;
  yesSupply: number;
  noSupply: number;
  totalVolume: number;
  resolutionTime: number;
  resolved: boolean;
  cancelled?: boolean;
  isBlocked?: boolean;
  marketType: 0 | 1;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
  creator?: string | null;
  socialLinks?: { twitter?: string; telegram?: string; website?: string } | null;
  sportMeta?: Record<string, unknown> | null;
  sport?: string | null;
  sportTradingState?: string | null;
  resolutionStatus?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

type FeaturedCarouselMarket = {
  id: string;
  dbId?: string;
  question: string;
  category: string;
  imageUrl?: string;
  volume: number;
  daysLeft: number;
  creator?: string;
  socialLinks?: { twitter?: string; telegram?: string; website?: string };
  yesSupply: number;
  noSupply: number;
  marketType?: number;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
  isLive?: boolean;
};

type HomeCarouselSlide =
  | { kind: "flash"; market: FlashMarket }
  | { kind: "featured"; market: FeaturedCarouselMarket };

type MarketStatusFilter = "all" | "open" | "resolved" | "ending_soon" | "top_volume";
const CAROUSEL_LIMIT = 5;

/* ── Helpers (same as page.tsx) ──────────────────────────────────── */

function normalizeCategoryId(raw: unknown): string {
  const s = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "sports_general" || s === "sport" || s === "sports") return "sports";
  if (s === "breaking_news") return "breaking";
  return s;
}

function normalizeSportSubcategoryValue(raw: unknown): "soccer" | "basketball" | "baseball" | "american_football" | "tennis" | null {
  const s = normalizeCategoryId(raw);
  if (s === "soccer" || s === "football") return "soccer";
  if (s === "basketball" || s === "nba") return "basketball";
  if (s === "baseball" || s === "mlb") return "baseball";
  if (s === "american_football" || s === "nfl" || s === "football_american") return "american_football";
  if (s === "tennis") return "tennis";
  if (s === "mma") return "baseball";
  return null;
}

function normalizeSportSubcategoryFromMarket(m: Market): string | null {
  const meta = (m.sportMeta || {}) as any;
  for (const c of [m.sport, meta?.sport, meta?.sport_type, meta?.raw?.sport, m.category]) {
    const n = normalizeSportSubcategoryValue(c);
    if (n) return n;
  }
  return null;
}

function isSportMarket(m: Market): boolean {
  return normalizeCategoryId(m.category) === "sports" || normalizeSportSubcategoryFromMarket(m) !== null;
}

function sportStatusSignals(m: Market): string[] {
  const meta = (m.sportMeta || {}) as any;
  const raw = (meta.raw || {}) as any;
  return [m.sportTradingState, meta?.status, raw?.status, raw?.state, raw?.fixture?.status?.short]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
}

function isSportLiveInProgress(m: Market): boolean {
  if (!isSportMarket(m)) return false;
  const status = sportStatusSignals(m);
  const live = ["live", "in_play", "inplay", "1h", "ht", "2h", "et", "p", "q1", "q2", "q3", "q4", "ot"];
  const finished = ["finished", "final", "ended", "ended_by_sport", "resolved", "cancelled", "postponed", "ft", "aet", "pen"];
  if (status.some((s) => live.includes(s))) return true;
  if (status.some((s) => finished.includes(s))) return false;
  const meta = (m.sportMeta || {}) as any;
  const startMs = parseUtcMs(m.startTime ?? meta?.start_time);
  let endMs = parseUtcMs(m.endTime ?? meta?.end_time);
  if (!Number.isFinite(endMs) && Number.isFinite(startMs)) {
    const sportKey = normalizeSportSubcategoryFromMarket(m) || String(m.sport || meta?.sport || "").toLowerCase();
    const dur = sportKey === "soccer" || sportKey === "football" ? 120 * 60_000 : sportKey === "basketball" || sportKey === "nba" ? 150 * 60_000 : NaN;
    if (Number.isFinite(dur)) endMs = startMs + dur;
  }
  const now = Date.now();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && now >= startMs && now < endMs;
}

function isSportFinishedByProvider(m: Market): boolean {
  return sportStatusSignals(m).some((s) =>
    ["finished", "final", "ended", "ended_by_sport", "resolved", "cancelled", "postponed", "ft", "aet", "pen"].includes(s)
  );
}

function parseUtcMs(raw: any): number {
  if (!raw) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;
  const hasTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(s);
  const normalized = s.includes(" ") ? s.replace(" ", "T") : s;
  return Date.parse(hasTz ? normalized : `${normalized}Z`) || NaN;
}

function mapRow(row: any): Market {
  const mt = (row.market_type ?? 0) as 0 | 1;
  const outcomeNames = Array.isArray(row.outcome_names) ? row.outcome_names.map((x: any) => String(x)).filter(Boolean) : undefined;
  const outcomeSupplies = Array.isArray(row.outcome_supplies) ? row.outcome_supplies.map((x: any) => Number(x) || 0) : undefined;
  let yesSupply = Number(row.yes_supply || 0);
  let noSupply = Number(row.no_supply || 0);
  if (mt === 1 && Array.isArray(outcomeSupplies) && outcomeSupplies.length >= 2) {
    yesSupply = outcomeSupplies[0];
    noSupply = outcomeSupplies[1];
  }
  const endDate = row.end_date ? new Date(row.end_date) : new Date();
  return {
    id: row.id, publicKey: row.market_address, question: row.question || "", description: row.description || "",
    category: row.category || "other", imageUrl: row.image_url ?? null, yesSupply, noSupply,
    totalVolume: Number(row.total_volume || 0), resolutionTime: Math.floor(endDate.getTime() / 1000),
    resolved: !!row.resolved, cancelled: !!row.cancelled, isBlocked: !!row.is_blocked, marketType: mt,
    outcomeNames, outcomeSupplies, creator: row.creator ?? null, socialLinks: row.social_links ?? null,
    sportMeta: row.sport_meta ?? null,
    sport: typeof row.sport === "string" ? row.sport : typeof row.sport_meta?.sport === "string" ? row.sport_meta.sport : null,
    sportTradingState: row.sport_trading_state ?? null, resolutionStatus: row.resolution_status ?? "open",
    startTime: row.start_time ?? null, endTime: row.end_time ?? null,
  };
}

/* ── StatusFilterDropdown ────────────────────────────────────────── */

function StatusFilterDropdown({ value, onChange }: { value: MarketStatusFilter; onChange: (v: MarketStatusFilter) => void }) {
  const [open, setOpen] = useState(false);
  const options: { value: MarketStatusFilter; label: string; icon?: string }[] = [
    { value: "all", label: "All" },
    { value: "open", label: "Open" },
    { value: "resolved", label: "Resolved" },
    { value: "ending_soon", label: "Ending Soon", icon: "⏰" },
    { value: "top_volume", label: "Top Volume", icon: "🔥" },
  ];
  const selected = options.find((o) => o.value === value);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-black text-white text-sm font-semibold hover:border-white/25 transition">
        <span className="text-gray-300">Filter:</span>
        <span>{selected?.icon && <span className="mr-1">{selected.icon}</span>}{selected?.label}</span>
        <ChevronDown className="w-4 h-4 text-gray-300" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/10 bg-[#0a0d12] shadow-xl overflow-hidden z-50">
          {options.map((opt) => (
            <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-4 py-3 text-sm transition flex items-center gap-2 ${value === opt.value ? "bg-white/5 text-white" : "text-gray-200 hover:bg-white/5"}`}>
              {opt.icon && <span>{opt.icon}</span>}<span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── SearchPage ──────────────────────────────────────────────────── */

export default function SearchPage() {
  const router = useRouter();

  // Data
  const [featuredClassicMarkets, setFeaturedClassicMarkets] = useState<Market[]>([]);
  const [openClassicMarkets, setOpenClassicMarkets] = useState<Market[]>([]);
  const [resolvedClassicMarkets, setResolvedClassicMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liveMap, setLiveMap] = useState<Record<string, string>>({});
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const [homeLiveFlashMarket, setHomeLiveFlashMarket] = useState<FlashMarket | null>(null);
  const [homeLiveCryptoFlashMarkets, setHomeLiveCryptoFlashMarkets] = useState<FlashMarket[]>([]);
  const [homeLiveIrlFlashMarkets, setHomeLiveIrlFlashMarkets] = useState<FlashMarket[]>([]);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<SelectedCategory>("all");
  const [statusFilter, setStatusFilter] = useState<MarketStatusFilter>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [displayedCount, setDisplayedCount] = useState(12);

  // Carousel
  const [currentFeaturedIndex, setCurrentFeaturedIndex] = useState(0);
  const mobileFeaturedRef = useRef<HTMLDivElement | null>(null);
  const observerTarget = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // All markets merged (for profile fetching)
  const allMarkets = useMemo(() => {
    const merged = [...openClassicMarkets, ...resolvedClassicMarkets, ...featuredClassicMarkets];
    const seen = new Set<string>();
    const out: Market[] = [];
    for (const m of merged) { if (m.publicKey && !seen.has(m.publicKey)) { seen.add(m.publicKey); out.push(m); } }
    return out;
  }, [openClassicMarkets, resolvedClassicMarkets, featuredClassicMarkets]);

  // ── Load data ─────────────────────────────────────────────────
  const refreshCryptoFlash = useCallback(async () => {
    try {
      const r = await fetch("/api/explorer/flash-markets?status=open&kind=crypto&limit=12");
      if (!r.ok) return;
      const p = await r.json();
      const now = Date.now();
      const list = Array.isArray(p?.markets) ? (p.markets as FlashMarket[]) : [];
      setHomeLiveCryptoFlashMarkets(list.filter((m) => m?.kind === "crypto" && m.status === "active" && now < Date.parse(String(m.windowEnd || ""))));
    } catch {}
  }, []);

  const refreshIrlFlash = useCallback(async () => {
    try {
      const r = await fetch("/api/explorer/flash-markets?status=open&kind=irl&limit=12");
      if (!r.ok) return;
      const p = await r.json();
      const now = Date.now();
      const list = Array.isArray(p?.markets) ? (p.markets as FlashMarket[]) : [];
      setHomeLiveIrlFlashMarkets(list.filter((m) => m?.kind === "irl" && m.status === "active" && now < Date.parse(String(m.windowEnd || ""))));
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/home");
        if (!res.ok) return;
        const json = await res.json();
        setFeaturedClassicMarkets((json.featuredMarkets || []).map(mapRow));
        setOpenClassicMarkets((json.openMarketsClassic || []).map(mapRow));
        setResolvedClassicMarkets((json.resolvedMarketsClassic || []).map(mapRow));
        setLiveMap(json.liveMap || {});
        setHomeLiveFlashMarket(json.topLiveFlashMarket ?? json.homeLiveFlashMarket ?? null);
        await Promise.all([refreshCryptoFlash(), refreshIrlFlash()]);
      } catch {}
      setLoading(false);
    })();
  }, [refreshCryptoFlash, refreshIrlFlash]);

  useEffect(() => {
    const t = setInterval(() => {
      void refreshCryptoFlash();
      void refreshIrlFlash();
    }, 10_000);
    return () => clearInterval(t);
  }, [refreshCryptoFlash, refreshIrlFlash]);

  // Profiles
  useEffect(() => {
    const addrs = allMarkets.map((m) => m.creator).filter((a): a is string => !!a);
    if (!addrs.length) return;
    const missing = Array.from(new Set(addrs)).filter((a) => !profilesMap[a]);
    if (!missing.length) return;
    let cancelled = false;
    getProfiles(missing).then((ps) => { if (!cancelled) setProfilesMap((prev) => { const n = { ...prev }; for (const p of ps) n[p.wallet_address] = p; return n; }); });
    return () => { cancelled = true; };
  }, [allMarkets]);

  // ── Category filter ───────────────────────────────────────────
  const matchesCategory = useCallback((m: Market) => {
    if (selectedCategory === "all") return true;
    if (selectedCategory === "sports") return isSportMarket(m);
    if (isSportSubcategory(selectedCategory)) {
      const w = normalizeSportSubcategoryValue(selectedCategory);
      return w ? normalizeSportSubcategoryFromMarket(m) === w : isSportMarket(m);
    }
    return normalizeCategoryId(m.category) === normalizeCategoryId(selectedCategory);
  }, [selectedCategory]);

  // Text search filter
  const matchesSearch = useCallback((m: Market) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return m.question.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q) || m.category?.toLowerCase().includes(q);
  }, [searchQuery]);

  const catOpen = useMemo(() => openClassicMarkets.filter(matchesCategory).filter(matchesSearch), [openClassicMarkets, matchesCategory, matchesSearch]);
  const catResolved = useMemo(() => resolvedClassicMarkets.filter(matchesCategory).filter(matchesSearch), [resolvedClassicMarkets, matchesCategory, matchesSearch]);
  const catAll = useMemo(() => [...catOpen, ...catResolved], [catOpen, catResolved]);

  // ── Status filter ─────────────────────────────────────────────
  const statusFiltered = useMemo(() => {
    const now = Date.now() / 1000;
    let list: Market[];
    if (statusFilter === "all") list = catAll;
    else if (statusFilter === "resolved") list = catResolved;
    else if (statusFilter === "ending_soon") { const in48 = now + 48 * 3600; list = catOpen.filter((m) => m.resolutionTime > now && m.resolutionTime <= in48); }
    else if (statusFilter === "top_volume") list = catOpen;
    else list = catOpen;

    if (statusFilter === "ending_soon") return [...list].sort((a, b) => a.resolutionTime - b.resolutionTime);
    if (statusFilter === "top_volume") return [...list].sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0));
    return list;
  }, [catAll, catOpen, catResolved, statusFilter]);

  // ── Featured carousel ─────────────────────────────────────────
  const featuredMarkets = useMemo<FeaturedCarouselMarket[]>(() => {
    return featuredClassicMarkets.filter(matchesCategory).slice(0, CAROUSEL_LIMIT).map((m) => {
      const now = Date.now() / 1000;
      return {
        id: m.publicKey, dbId: m.id, question: m.question, category: m.category,
        imageUrl: m.imageUrl ?? undefined, volume: m.totalVolume,
        daysLeft: Math.max(0, Math.floor((m.resolutionTime - now) / 86400)),
        creator: m.creator ?? undefined, socialLinks: m.socialLinks ?? undefined,
        yesSupply: m.yesSupply, noSupply: m.noSupply, marketType: m.marketType,
        outcomeNames: m.outcomeNames, outcomeSupplies: m.outcomeSupplies,
        isLive: isSportLiveInProgress(m),
      };
    });
  }, [featuredClassicMarkets, matchesCategory]);

  const carouselSlides = useMemo<HomeCarouselSlide[]>(() => {
    const flash: HomeCarouselSlide[] = [];
    const seen = new Set<string>();
    if (homeLiveFlashMarket) { const a = String(homeLiveFlashMarket.marketAddress || "").trim(); if (a && !seen.has(a)) { seen.add(a); flash.push({ kind: "flash", market: homeLiveFlashMarket }); } }
    for (const m of homeLiveCryptoFlashMarkets) { const a = String(m.marketAddress || "").trim(); if (a && !seen.has(a)) { seen.add(a); flash.push({ kind: "flash", market: m }); } }
    for (const m of homeLiveIrlFlashMarkets) { const a = String(m.marketAddress || "").trim(); if (a && !seen.has(a)) { seen.add(a); flash.push({ kind: "flash", market: m }); } }
    const scoped = flash.slice(0, CAROUSEL_LIMIT);
    const base = featuredMarkets.slice(0, Math.max(0, CAROUSEL_LIMIT - scoped.length)).map((m) => ({ kind: "featured" as const, market: m }));
    return [...scoped, ...base];
  }, [featuredMarkets, homeLiveCryptoFlashMarkets, homeLiveFlashMarket, homeLiveIrlFlashMarkets]);

  useEffect(() => { setCurrentFeaturedIndex(0); const el = mobileFeaturedRef.current; if (el) el.scrollLeft = 0; }, [carouselSlides.length]);

  // ── Infinite scroll ───────────────────────────────────────────
  const displayed = useMemo(() => statusFiltered.slice(0, displayedCount), [statusFiltered, displayedCount]);

  useEffect(() => {
    const obs = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !loading && statusFiltered.length > displayedCount) loadMore(); }, { threshold: 0.1 });
    const t = observerTarget.current;
    if (t) obs.observe(t);
    return () => { if (t) obs.unobserve(t); };
  }, [displayedCount, loading, statusFiltered.length]);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => { setDisplayedCount((p) => p + 12); setLoadingMore(false); }, 400);
  }, [loadingMore]);

  useEffect(() => { setDisplayedCount(12); }, [selectedCategory, statusFilter, searchQuery]);

  // ── Carousel scroll helpers ───────────────────────────────────
  const onMobileScroll = () => {
    const el = mobileFeaturedRef.current;
    if (!el) return;
    const children = Array.from(el.children) as HTMLElement[];
    if (!children.length) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < children.length; i++) {
      const d = Math.abs(children[i].offsetLeft + children[i].clientWidth / 2 - center);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best !== currentFeaturedIndex) setCurrentFeaturedIndex(best);
  };

  const scrollMobileTo = (i: number) => {
    const el = mobileFeaturedRef.current;
    if (!el) return;
    (el.children[i] as HTMLElement | undefined)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    setCurrentFeaturedIndex(i);
  };

  const getSectionTitle = () => {
    switch (statusFilter) {
      case "ending_soon": return "⏰ Ending Soon";
      case "top_volume": return "🔥 Top Volume";
      case "resolved": return "Resolved Markets";
      case "open": return "Open Markets";
      default: return "All Markets";
    }
  };

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black">
      {/* ── Top bar: back + search ── */}
      <div className="sticky top-0 z-40 bg-black/90 backdrop-blur border-b border-gray-800">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-full bg-black/40 border border-gray-800 flex-shrink-0" aria-label="Back">
            <ArrowLeft className="w-[18px] h-[18px] text-white/90" />
          </button>
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search markets..."
            className="flex-1 rounded-xl bg-black/40 border border-gray-800 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 outline-none focus:border-pump-green/60"
          />
        </div>

        {/* Category filters */}
        <div className="px-4">
          <CategoryFilters selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />
        </div>
      </div>

      {/* ── Featured carousel (mobile swipe) ── */}
      <div className="py-4 bg-gradient-to-b from-pump-dark to-transparent">
        <div className="px-4">
          <h2 className="text-xl font-bold text-white mb-3">Top markets</h2>

          {loading ? (
            <SkeletonFeaturedCard />
          ) : carouselSlides.length > 0 ? (
            <>
              <div
                ref={mobileFeaturedRef}
                onScroll={onMobileScroll}
                className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {carouselSlides.map((slide) => (
                  <div
                    key={slide.kind === "flash" ? `flash-${slide.market.liveMicroId}` : `featured-${slide.market.id}`}
                    className="min-w-[92%] snap-center h-[520px]"
                  >
                    {slide.kind === "flash" ? (
                      <FlashMarketCard market={slide.market} variant="hero" className="h-[520px]" />
                    ) : (
                      <FeaturedMarketCardFull
                        market={slide.market}
                        liveSessionId={liveMap[slide.market.id] || null}
                        creatorProfile={slide.market.creator ? profilesMap[slide.market.creator] ?? null : null}
                      />
                    )}
                  </div>
                ))}
              </div>

              {carouselSlides.length > 1 && (
                <div className="flex justify-center gap-2 mt-2">
                  {carouselSlides.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => scrollMobileTo(index)}
                      className={`h-2 rounded-full transition-all duration-300 ${index === currentFeaturedIndex ? "w-8 bg-white" : "w-2 bg-white/30"}`}
                      aria-label={`Go to featured market ${index + 1}`}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-400"><p>No featured markets</p></div>
          )}
        </div>
      </div>

      {/* ── Markets grid with status filter ── */}
      <div className="px-4 py-4 pb-20">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">{getSectionTitle()}</h3>
            <p className="text-xs text-gray-500">
              {statusFiltered.length} market{statusFiltered.length !== 1 ? "s" : ""}
              {statusFilter === "ending_soon" && " ending within 48h"}
              {statusFilter === "top_volume" && " sorted by volume"}
            </p>
          </div>
          <StatusFilterDropdown value={statusFilter} onChange={setStatusFilter} />
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">
              {statusFilter === "ending_soon" ? "⏰" : statusFilter === "top_volume" ? "📊" : "🤷"}
            </div>
            <p className="text-gray-400 text-lg mb-3">
              {statusFilter === "ending_soon" ? "No markets ending soon" : statusFilter === "top_volume" ? "No active markets with volume" : "No markets found"}
            </p>
            <Link href="/create"><button className="btn-pump">Create the first one!</button></Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4">
              {displayed.map((market, index) => (
                <motion.div
                  key={market.publicKey}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-30px" }}
                  transition={{ duration: 0.3, delay: index * 0.02 }}
                >
                  <MarketCard
                    market={market as any}
                    liveSessionId={liveMap[market.publicKey] || null}
                    liveMatch={isSportLiveInProgress(market)}
                    finishedMatch={isSportFinishedByProvider(market)}
                    creatorAddress={market.creator}
                    creatorProfile={market.creator ? profilesMap[market.creator] ?? null : null}
                  />
                </motion.div>
              ))}
            </div>

            {displayedCount < statusFiltered.length && (
              <div ref={observerTarget} className="text-center py-10">
                {loadingMore ? (
                  <div className="inline-block animate-spin rounded-full h-7 w-7 border-b-2 border-pump-green" />
                ) : (
                  <button type="button" onClick={loadMore} className="px-8 py-3 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg text-white font-semibold transition">
                    Load More Markets
                  </button>
                )}
              </div>
            )}

            {displayedCount >= statusFiltered.length && statusFiltered.length > 12 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-6 text-gray-500 text-sm">
                You&apos;ve reached the end
              </motion.div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
