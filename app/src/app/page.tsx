// src/app/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronDown, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import MarketCard from "@/components/MarketCard";
import FeaturedMarketCardFull from "@/components/FeaturedMarketCardFull";
import FlashMarketCard from "@/components/FlashMarketCard";
import CategoryFilters from "@/components/CategoryFilters";
import type { SelectedCategory } from "@/components/CategoryFilters";
import { SkeletonCard, SkeletonFeaturedCard } from "@/components/SkeletonCard";
import HomeFeedItem from "@/components/HomeFeedItem";
import FeedTradeSheet from "@/components/FeedTradeSheet";
import HomeFeedActionRail from "@/components/HomeFeedActionRail";
import HomeFeedCommentsSheet from "@/components/HomeFeedCommentsSheet";
import { isSportSubcategory } from "@/utils/categories";
import { getProfiles, type Profile } from "@/lib/profiles";
import type { FlashMarket } from "@/lib/flashMarkets/types";

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
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  } | null;

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
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
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
type MobileFeedEntry =
  | { kind: "classic"; market: Market }
  | { kind: "flash"; market: FlashMarket };

type MarketStatusFilter = "all" | "open" | "resolved" | "ending_soon" | "top_volume";
const CAROUSEL_LIMIT = 5;
const MOBILE_HOME_RETAP_EVENT = "home-feed:retap";
const MOBILE_FEED_RESTORE_KEY = "home-feed:restore:v1";

const DEBUG_SPORT_OPEN_FILTER = false;

function normalizeCategoryId(raw: unknown): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (s === "sports_general" || s === "sport" || s === "sports") return "sports";
  if (s === "breaking_news") return "breaking";
  return s;
}

function normalizeSportSubcategoryValue(raw: unknown): "soccer" | "basketball" | "baseball" | "american_football" | "tennis" | null {
  const s = normalizeCategoryId(raw);
  if (!s) return null;
  if (s === "soccer" || s === "football") return "soccer";
  if (s === "basketball" || s === "nba") return "basketball";
  if (s === "baseball" || s === "mlb") return "baseball";
  if (s === "american_football" || s === "nfl" || s === "football_american") return "american_football";
  if (s === "tennis") return "tennis";
  // TODO: legacy data mapped some baseball fixtures to "mma"; keep UI mapping stable.
  if (s === "mma") return "baseball";
  return null;
}

function normalizeSportSubcategoryFromMarket(m: Market): "soccer" | "basketball" | "baseball" | "american_football" | "tennis" | null {
  const meta = (m.sportMeta || {}) as any;
  const candidates = [
    m.sport,
    meta?.sport,
    meta?.sport_type,
    meta?.raw?.sport,
    m.category,
  ];
  for (const c of candidates) {
    const normalized = normalizeSportSubcategoryValue(c);
    if (normalized) return normalized;
  }
  return null;
}

function sportStatusSignals(m: Market): string[] {
  const meta = (m.sportMeta || {}) as any;
  const raw = (meta.raw || {}) as any;
  const fixtureShort = raw?.fixture?.status?.short;
  const vals = [
    m.sportTradingState,
    meta?.status,
    raw?.status,
    raw?.state,
    fixtureShort,
  ];
  return vals
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
}

function isSportOpenByProvider(m: Market): boolean {
  const status = sportStatusSignals(m);
  const isLive = status.some((s) =>
    ["live", "in_play", "inplay", "open", "locked_by_sport", "1h", "ht", "2h", "et", "p", "q1", "q2", "q3", "q4", "ot"].includes(s)
  );
  if (DEBUG_SPORT_OPEN_FILTER && isLive) {
    console.debug("[sport-open-filter] treating as open by provider", m.publicKey, status);
  }
  return isLive;
}

function isSportFinishedByProvider(m: Market): boolean {
  const status = sportStatusSignals(m);
  return status.some((s) =>
    ["finished", "final", "ended", "ended_by_sport", "resolved", "cancelled", "postponed", "ft", "aet", "pen"].includes(s)
  );
}

function isSportMarket(m: Market): boolean {
  return normalizeCategoryId(m.category) === "sports" || normalizeSportSubcategoryFromMarket(m) !== null;
}

function isSportLiveInProgress(m: Market): boolean {
  if (!isSportMarket(m)) return false;
  const status = sportStatusSignals(m);
  const liveSignals = ["live", "in_play", "inplay", "1h", "ht", "2h", "et", "p", "q1", "q2", "q3", "q4", "ot"];
  const finishedSignals = ["finished", "final", "ended", "ended_by_sport", "resolved", "cancelled", "postponed", "ft", "aet", "pen"];

  if (status.some((s) => liveSignals.includes(s))) return true;
  if (status.some((s) => finishedSignals.includes(s))) return false;

  const meta = (m.sportMeta || {}) as any;
  const startMs = parseUtcMs(m.startTime ?? meta?.start_time);
  let endMs = parseUtcMs(m.endTime ?? meta?.end_time);
  if (!Number.isFinite(endMs) && Number.isFinite(startMs)) {
    const sportKey = normalizeSportSubcategoryFromMarket(m) || String(m.sport || meta?.sport || "").toLowerCase();
    const durationMs = homeSportDurationMs(sportKey);
    if (Number.isFinite(durationMs)) endMs = startMs + durationMs;
  }
  const nowMs = Date.now();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && nowMs >= startMs && nowMs < endMs;
}

function parseUtcMs(raw: any): number {
  if (!raw) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;
  const hasTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(s);
  const normalized = s.includes(" ") ? s.replace(" ", "T") : s;
  const ms = Date.parse(hasTz ? normalized : `${normalized}Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

function homeSportDurationMs(sport: string | null | undefined): number {
  const s = String(sport || "").toLowerCase();
  if (s === "soccer" || s === "football") return 120 * 60_000;
  if (s === "basketball" || s === "nba") return 150 * 60_000;
  return NaN;
}

function mobileFeedEntryKey(entry: MobileFeedEntry): string {
  if (entry.kind === "classic") return `classic:${entry.market.publicKey}`;
  const addr = String(entry.market.marketAddress || "").trim();
  if (addr) return `flash:${addr}`;
  return `flash-live:${entry.market.liveMicroId}`;
}

function mapHomeRowToMarket(row: any): Market {
  const mt = (row.market_type ?? 0) as 0 | 1;

  const outcomeNames: string[] | undefined = Array.isArray(row.outcome_names)
    ? row.outcome_names.map((x: any) => String(x)).filter(Boolean)
    : undefined;

  const outcomeSupplies: number[] | undefined = Array.isArray(row.outcome_supplies)
    ? row.outcome_supplies.map((x: any) => Number(x) || 0)
    : undefined;

  let yesSupply = Number(row.yes_supply || 0);
  let noSupply = Number(row.no_supply || 0);

  if (mt === 1 && Array.isArray(outcomeSupplies) && outcomeSupplies.length >= 2) {
    yesSupply = Number(outcomeSupplies[0] || 0);
    noSupply = Number(outcomeSupplies[1] || 0);
  }

  const endDate = row.end_date ? new Date(row.end_date) : new Date();

  return {
    id: row.id,
    publicKey: row.market_address,
    question: row.question || "",
    description: row.description || "",
    category: row.category || "other",
    imageUrl: row.image_url ?? null,
    yesSupply,
    noSupply,
    totalVolume: Number(row.total_volume || 0),
    resolutionTime: Math.floor(endDate.getTime() / 1000),
    resolved: !!row.resolved,
    cancelled: !!row.cancelled,
    isBlocked: !!row.is_blocked,
    marketType: mt,
    outcomeNames,
    outcomeSupplies,
    creator: row.creator ?? null,
    socialLinks: row.social_links ?? null,
    sportMeta: row.sport_meta ?? null,
    sport:
      typeof row.sport === "string"
        ? row.sport
        : typeof row.sport_meta?.sport === "string"
        ? row.sport_meta.sport
        : null,
    sportTradingState: row.sport_trading_state ?? null,
    resolutionStatus: row.resolution_status ?? "open",
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
  };
}

function StatusFilterDropdown({
  value,
  onChange,
}: {
  value: MarketStatusFilter;
  onChange: (v: MarketStatusFilter) => void;
}) {
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-black text-white text-sm font-semibold hover:border-white/25 transition"
      >
        <span className="text-gray-300">Filter:</span>
        <span>
          {selected?.icon && <span className="mr-1">{selected.icon}</span>}
          {selected?.label}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-300" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/10 bg-[#0a0d12] shadow-xl overflow-hidden z-50">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-3 text-sm transition flex items-center gap-2 ${
                value === opt.value ? "bg-white/5 text-white" : "text-gray-200 hover:bg-white/5"
              }`}
            >
              {opt.icon && <span>{opt.icon}</span>}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [featuredClassicMarkets, setFeaturedClassicMarkets] = useState<Market[]>([]);
  const [openClassicMarkets, setOpenClassicMarkets] = useState<Market[]>([]);
  const [resolvedClassicMarkets, setResolvedClassicMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<SelectedCategory>("all");
  const [statusFilter, setStatusFilter] = useState<MarketStatusFilter>("open");

  const [currentFeaturedIndex, setCurrentFeaturedIndex] = useState(0);
  const [homeLiveFlashMarket, setHomeLiveFlashMarket] = useState<FlashMarket | null>(null);
  const [homeLiveCryptoFlashMarkets, setHomeLiveCryptoFlashMarkets] = useState<FlashMarket[]>([]);
  const [homeLiveIrlFlashMarkets, setHomeLiveIrlFlashMarkets] = useState<FlashMarket[]>([]);
  const [displayedCount, setDisplayedCount] = useState(12);
  const router = useRouter();
  const sp = useSearchParams();

  // Live session map: market_address -> session id
  const [liveMap, setLiveMap] = useState<Record<string, string>>({});

  // Creator profiles map: wallet_address -> Profile
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});

  const observerTarget = useRef<HTMLDivElement>(null);
  const mobileFeedRef = useRef<HTMLDivElement | null>(null);

  // ✅ used only on mobile to detect which slide is centered
  const mobileFeaturedRef = useRef<HTMLDivElement | null>(null);

  const markets = useMemo(() => {
    const merged = [...openClassicMarkets, ...resolvedClassicMarkets, ...featuredClassicMarkets];
    const seen = new Set<string>();
    const out: Market[] = [];
    for (const market of merged) {
      const key = market.publicKey;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(market);
    }
    return out;
  }, [openClassicMarkets, resolvedClassicMarkets, featuredClassicMarkets]);

  const refreshHomeLiveCryptoFlashMarkets = useCallback(async () => {
    try {
      const response = await fetch("/api/explorer/flash-markets?status=open&kind=crypto&limit=12");
      if (!response.ok) return;
      const payload = await response.json();
      const nowMs = Date.now();
      const incoming = Array.isArray(payload?.markets) ? (payload.markets as FlashMarket[]) : [];
      const filtered = incoming.filter((market) => {
        if (!market || market.kind !== "crypto") return false;
        if (market.status !== "active") return false;
        const windowEndMs = Date.parse(String(market.windowEnd || ""));
        return Number.isFinite(windowEndMs) && nowMs < windowEndMs;
      });
      setHomeLiveCryptoFlashMarkets(filtered);
    } catch {
      // Keep existing list on transient network failures.
    }
  }, []);

  const refreshHomeLiveIrlFlashMarkets = useCallback(async () => {
    try {
      const response = await fetch("/api/explorer/flash-markets?status=open&kind=irl&limit=12");
      if (!response.ok) return;
      const payload = await response.json();
      const nowMs = Date.now();
      const incoming = Array.isArray(payload?.markets) ? (payload.markets as FlashMarket[]) : [];
      const filtered = incoming.filter((market) => {
        if (!market || market.kind !== "irl") return false;
        if (market.status !== "active") return false;
        const windowEndMs = Date.parse(String(market.windowEnd || ""));
        return Number.isFinite(windowEndMs) && nowMs < windowEndMs;
      });
      setHomeLiveIrlFlashMarkets(filtered);
    } catch {
      // Keep existing list on transient network failures.
    }
  }, []);

  const loadMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const reqStart = performance.now();
      const res = await fetch("/api/home");
      if (process.env.NODE_ENV !== "production") {
        const sinceNavMs = performance.now();
        const apiDurationMs = sinceNavMs - reqStart;
        console.debug("[home-perf] /api/home", {
          sinceNavigationMs: Math.round(sinceNavMs),
          requestDurationMs: Math.round(apiDurationMs),
          status: res.status,
        });
      }
      if (!res.ok) {
        console.error("Error loading markets:", res.status);
        setFeaturedClassicMarkets([]);
        setOpenClassicMarkets([]);
        setResolvedClassicMarkets([]);
        return;
      }
      const json = await res.json();
      const featuredData = json.featuredMarkets || [];
      const openClassicData = json.openMarketsClassic || [];
      const resolvedClassicData = json.resolvedMarketsClassic || [];
      const liveMapData = json.liveMap || {};
      const topHomeLiveFlash =
        (json.topLiveFlashMarket as FlashMarket | null) ??
        (json.homeLiveFlashMarket as FlashMarket | null) ??
        null;

      setLiveMap(liveMapData);
      setHomeLiveFlashMarket(topHomeLiveFlash);
      await Promise.all([refreshHomeLiveCryptoFlashMarkets(), refreshHomeLiveIrlFlashMarkets()]);

      setFeaturedClassicMarkets((featuredData as any[]).map(mapHomeRowToMarket));
      setOpenClassicMarkets((openClassicData as any[]).map(mapHomeRowToMarket));
      setResolvedClassicMarkets((resolvedClassicData as any[]).map(mapHomeRowToMarket));

      if (process.env.NODE_ENV !== "production") {
        console.log("home data loaded", {
          featured: (featuredData as any[])?.length || 0,
          openClassic: (openClassicData as any[])?.length || 0,
          resolvedClassic: (resolvedClassicData as any[])?.length || 0,
          hasTopLiveFlash: !!topHomeLiveFlash,
        });
      }
    } catch (err) {
      console.error("loadMarkets fatal error:", err);
      setFeaturedClassicMarkets([]);
      setOpenClassicMarkets([]);
      setResolvedClassicMarkets([]);
      setHomeLiveFlashMarket(null);
      setHomeLiveCryptoFlashMarkets([]);
      setHomeLiveIrlFlashMarkets([]);
    } finally {
      setLoading(false);
    }
  }, [refreshHomeLiveCryptoFlashMarkets, refreshHomeLiveIrlFlashMarkets]);

  // ------- LOAD MARKETS FROM SERVER API (cached) -------
  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  useEffect(() => {
    const handleHomeRetap = () => {
      const el = mobileFeedRef.current;
      if (el) {
        el.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      sessionStorage.removeItem(MOBILE_FEED_RESTORE_KEY);
      void loadMarkets();
    };

    window.addEventListener(MOBILE_HOME_RETAP_EVENT, handleHomeRetap);
    return () => window.removeEventListener(MOBILE_HOME_RETAP_EVENT, handleHomeRetap);
  }, [loadMarkets]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshHomeLiveCryptoFlashMarkets();
      void refreshHomeLiveIrlFlashMarkets();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshHomeLiveCryptoFlashMarkets, refreshHomeLiveIrlFlashMarkets]);

  // Batch-fetch creator profiles when markets change
  useEffect(() => {
    const addrs = markets.map((m) => m.creator).filter((a): a is string => !!a);
    if (!addrs.length) return;
    const unique = Array.from(new Set(addrs));
    // Only fetch addresses we don't have yet
    const missing = unique.filter((a) => !profilesMap[a]);
    if (!missing.length) return;
    let cancelled = false;
    getProfiles(missing).then((profiles) => {
      if (cancelled) return;
      setProfilesMap((prev) => {
        const next = { ...prev };
        for (const p of profiles) next[p.wallet_address] = p;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [markets]);

  // ✅ read status from URL (keeps last selected when coming back)
  useEffect(() => {
    const s = sp.get("status") as MarketStatusFilter | null;
    if (s && ["all", "open", "resolved", "ending_soon", "top_volume"].includes(s)) {
      setStatusFilter(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  // ------- FILTERS -------
  const matchesSelectedCategory = useCallback(
    (m: Market) => {
      if (selectedCategory === "all") return true;
      if (selectedCategory === "sports") return isSportMarket(m);

      if (isSportSubcategory(selectedCategory)) {
        const wanted = normalizeSportSubcategoryValue(selectedCategory);
        if (!wanted) return isSportMarket(m);
        return normalizeSportSubcategoryFromMarket(m) === wanted;
      }

      const selectedNorm = normalizeCategoryId(selectedCategory);
      return normalizeCategoryId(m.category) === selectedNorm;
    },
    [selectedCategory],
  );

  const categoryFilteredOpen = useMemo(
    () => openClassicMarkets.filter(matchesSelectedCategory),
    [openClassicMarkets, matchesSelectedCategory],
  );
  const categoryFilteredResolved = useMemo(
    () => resolvedClassicMarkets.filter(matchesSelectedCategory),
    [resolvedClassicMarkets, matchesSelectedCategory],
  );
  const categoryFilteredAll = useMemo(
    () => [...categoryFilteredOpen, ...categoryFilteredResolved],
    [categoryFilteredOpen, categoryFilteredResolved],
  );

  const statusFiltered = useMemo(() => {
    const nowSec = Date.now() / 1000;

    // First filter by base status
    let filtered: Market[];

    if (statusFilter === "all") {
      filtered = categoryFilteredAll;
    } else if (statusFilter === "resolved") {
      filtered = categoryFilteredResolved;
    } else if (statusFilter === "ending_soon") {
      // Only open markets ending within 48 hours
      const in48h = nowSec + 48 * 60 * 60;
      filtered = categoryFilteredOpen.filter((m) => {
        return m.resolutionTime > nowSec && m.resolutionTime <= in48h;
      });
    } else if (statusFilter === "top_volume") {
      // Only open markets, will be sorted by volume
      filtered = categoryFilteredOpen;
    } else {
      // "open" - default
      filtered = categoryFilteredOpen;
    }

    // Then sort based on filter type
    if (statusFilter === "ending_soon") {
      // Sort by closest end time first
      return [...filtered].sort((a, b) => a.resolutionTime - b.resolutionTime);
    } else if (statusFilter === "top_volume") {
      // Sort by highest volume first
      return [...filtered].sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0));
    }

    // Default: keep original order (created_at desc)
    return filtered;
  }, [categoryFilteredAll, categoryFilteredOpen, categoryFilteredResolved, statusFilter]);

  // ------- FEATURED (from API, filtered by category only) -------
  const featuredMarkets = useMemo<FeaturedCarouselMarket[]>(() => {
    const base = featuredClassicMarkets.filter(matchesSelectedCategory).slice(0, CAROUSEL_LIMIT);
    return base.map((market) => {
        const now = Date.now() / 1000;
        const daysLeft = Math.max(0, Math.floor((market.resolutionTime - now) / 86400));

        return {
          id: market.publicKey, // route /trade/:id (on-chain address)
          dbId: market.id, // ✅ for odds chart fetch
          question: market.question,
          category: market.category,
          imageUrl: market.imageUrl ?? undefined,
          volume: market.totalVolume,
          daysLeft,
          creator: market.creator ?? undefined,
          socialLinks: market.socialLinks ?? undefined,
          yesSupply: market.yesSupply,
          noSupply: market.noSupply,
          marketType: market.marketType,
          outcomeNames: market.outcomeNames,
          outcomeSupplies: market.outcomeSupplies,
          isLive: isSportLiveInProgress(market),
        };
      });
  }, [featuredClassicMarkets, matchesSelectedCategory]);

  const carouselSlides = useMemo<HomeCarouselSlide[]>(() => {
    const flashSlides: HomeCarouselSlide[] = [];
    const seenFlashAddresses = new Set<string>();

    if (homeLiveFlashMarket) {
      const addr = String(homeLiveFlashMarket.marketAddress || "").trim();
      if (addr && !seenFlashAddresses.has(addr)) {
        seenFlashAddresses.add(addr);
        flashSlides.push({ kind: "flash", market: homeLiveFlashMarket });
      }
    }

    for (const market of homeLiveCryptoFlashMarkets) {
      const addr = String(market.marketAddress || "").trim();
      if (!addr || seenFlashAddresses.has(addr)) continue;
      seenFlashAddresses.add(addr);
      flashSlides.push({ kind: "flash", market });
    }

    for (const market of homeLiveIrlFlashMarkets) {
      const addr = String(market.marketAddress || "").trim();
      if (!addr || seenFlashAddresses.has(addr)) continue;
      seenFlashAddresses.add(addr);
      flashSlides.push({ kind: "flash", market });
    }

    const scopedFlashSlides = flashSlides.slice(0, CAROUSEL_LIMIT);
    const baseSlides = featuredMarkets.slice(0, Math.max(0, CAROUSEL_LIMIT - scopedFlashSlides.length));
    const mappedBase = baseSlides.map((market) => ({ kind: "featured" as const, market }));
    return [...scopedFlashSlides, ...mappedBase];
  }, [featuredMarkets, homeLiveCryptoFlashMarkets, homeLiveFlashMarket, homeLiveIrlFlashMarkets]);

  // reset index when list changes
  useEffect(() => {
    setCurrentFeaturedIndex(0);
    // reset scroll position on mobile
    const el = mobileFeaturedRef.current;
    if (el) el.scrollLeft = 0;
  }, [carouselSlides.length]);

  // ------- INFINITE SCROLL -------
  const displayedMarkets = useMemo(() => statusFiltered.slice(0, displayedCount), [statusFiltered, displayedCount]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && statusFiltered.length > displayedCount) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const t = observerTarget.current;
    if (t) observer.observe(t);
    return () => {
      if (t) observer.unobserve(t);
    };
  }, [displayedCount, loading, statusFiltered.length]);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setDisplayedCount((prev) => prev + 12);
      setLoadingMore(false);
    }, 400);
  }, [loadingMore]);

  useEffect(() => {
    setDisplayedCount(12);
  }, [selectedCategory, statusFilter]);

  // ✅ persist status in URL
  useEffect(() => {
    const params = new URLSearchParams(sp.toString());
    params.set("status", statusFilter);
    router.replace(`/?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // ------- DESKTOP BUTTONS -------
  const handlePrevFeatured = () => {
    if (!carouselSlides.length) return;
    setCurrentFeaturedIndex((prev) => (prev === 0 ? carouselSlides.length - 1 : prev - 1));
  };

  const handleNextFeatured = () => {
    if (!carouselSlides.length) return;
    setCurrentFeaturedIndex((prev) => (prev === carouselSlides.length - 1 ? 0 : prev + 1));
  };

  // ------- MOBILE: update dots based on scroll (simple center calc) -------
  const onMobileScroll = () => {
    const el = mobileFeaturedRef.current;
    if (!el) return;

    const children = Array.from(el.children) as HTMLElement[];
    if (!children.length) return;

    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;

    for (let i = 0; i < children.length; i++) {
      const c = children[i]!;
      const cCenter = c.offsetLeft + c.clientWidth / 2;
      const d = Math.abs(cCenter - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }

    if (best !== currentFeaturedIndex) setCurrentFeaturedIndex(best);
  };

  const scrollMobileTo = (i: number) => {
    const el = mobileFeaturedRef.current;
    if (!el) return;
    const target = el.children[i] as HTMLElement | undefined;
    target?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    setCurrentFeaturedIndex(i);
  };

  // ------- Helper for section title -------
  const getSectionTitle = () => {
    switch (statusFilter) {
      case "ending_soon":
        return "⏰ Ending Soon";
      case "top_volume":
        return "🔥 Top Volume";
      case "resolved":
        return "Resolved Markets";
      case "open":
        return "Open Markets";
      default:
        return "All Markets";
    }
  };

  const activeFlashFeedMarkets = useMemo(() => {
    const nowMs = Date.now();
    const out: FlashMarket[] = [];
    const seen = new Set<string>();
    const includeIfActive = (market: FlashMarket | null | undefined) => {
      if (!market || market.status !== "active") return;
      const addr = String(market.marketAddress || "").trim();
      const dedupeKey = addr || `liveMicro:${market.liveMicroId}`;
      if (seen.has(dedupeKey)) return;
      const windowEndMs = Date.parse(String(market.windowEnd || ""));
      if (Number.isFinite(windowEndMs) && nowMs >= windowEndMs) return;
      seen.add(dedupeKey);
      out.push(market);
    };

    includeIfActive(homeLiveFlashMarket);
    for (const market of homeLiveCryptoFlashMarkets) includeIfActive(market);
    for (const market of homeLiveIrlFlashMarkets) includeIfActive(market);
    return out;
  }, [homeLiveCryptoFlashMarkets, homeLiveFlashMarket, homeLiveIrlFlashMarkets]);

  // ------- Classic feed markets: live first, then remaining open -------
  const prioritizedClassicFeedMarkets = useMemo(() => {
    const merged = [...openClassicMarkets];
    const seen = new Set(merged.map((m) => m.publicKey));
    for (const m of featuredClassicMarkets) {
      if (!seen.has(m.publicKey)) {
        seen.add(m.publicKey);
        merged.push(m);
      }
    }

    // Keep volume sort inside live/rest buckets.
    return merged
      .filter((m) => !m.resolved && !m.cancelled && !m.isBlocked)
      .sort((a, b) => {
        const aLive = isSportLiveInProgress(a) || !!liveMap[a.publicKey];
        const bLive = isSportLiveInProgress(b) || !!liveMap[b.publicKey];
        if (aLive !== bLive) return aLive ? -1 : 1;
        return (b.totalVolume || 0) - (a.totalVolume || 0);
      });
  }, [featuredClassicMarkets, liveMap, openClassicMarkets]);

  // ------- Mobile feed: live classic, then live flash, then remaining open -------
  const mobileFeedEntries = useMemo<MobileFeedEntry[]>(() => {
    const liveClassic: MobileFeedEntry[] = [];
    const remainingClassic: MobileFeedEntry[] = [];

    for (const market of prioritizedClassicFeedMarkets) {
      const isLive = isSportLiveInProgress(market) || !!liveMap[market.publicKey];
      if (isLive) liveClassic.push({ kind: "classic", market });
      else remainingClassic.push({ kind: "classic", market });
    }

    const liveFlash: MobileFeedEntry[] = activeFlashFeedMarkets.map((market) => ({ kind: "flash", market }));
    return [...liveClassic, ...liveFlash, ...remainingClassic];
  }, [activeFlashFeedMarkets, liveMap, prioritizedClassicFeedMarkets]);

  const saveFeedRestoreState = useCallback(
    (entryKey?: string, index?: number) => {
      const el = mobileFeedRef.current;
      if (!el) return;
      const safeHeight = Math.max(el.clientHeight, 1);
      const fallbackIndex = Math.max(0, Math.round(el.scrollTop / safeHeight));
      const parsedIndex =
        typeof index === "number" && Number.isFinite(index) ? index : fallbackIndex;
      const nextIndex = Math.max(0, Math.floor(parsedIndex));
      const nextEntryKey = entryKey || (mobileFeedEntries[nextIndex] ? mobileFeedEntryKey(mobileFeedEntries[nextIndex]!) : null);
      const payload = {
        marketKey: nextEntryKey,
        index: nextIndex,
        scrollTop: el.scrollTop,
        at: Date.now(),
        pending: true,
      };
      sessionStorage.setItem(MOBILE_FEED_RESTORE_KEY, JSON.stringify(payload));
    },
    [mobileFeedEntries]
  );

  useEffect(() => {
    if (loading || mobileFeedEntries.length === 0) return;

    const raw = sessionStorage.getItem(MOBILE_FEED_RESTORE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as {
        marketKey?: string | null;
        index?: number;
        scrollTop?: number;
        at?: number;
        pending?: boolean;
      };
      if (!parsed?.pending) return;

      const savedAt = Number(parsed.at || 0);
      if (!Number.isFinite(savedAt) || Date.now() - savedAt > 30 * 60_000) {
        sessionStorage.removeItem(MOBILE_FEED_RESTORE_KEY);
        return;
      }

      const el = mobileFeedRef.current;
      if (!el) return;

      let targetIndex = Number.isFinite(parsed.index) ? Number(parsed.index) : 0;
      const savedKey = String(parsed.marketKey || "").trim();
      if (savedKey) {
        const foundIndex = mobileFeedEntries.findIndex((entry) => mobileFeedEntryKey(entry) === savedKey);
        if (foundIndex >= 0) targetIndex = foundIndex;
      }
      targetIndex = Math.max(0, Math.min(mobileFeedEntries.length - 1, targetIndex));

      const safeHeight = Math.max(el.clientHeight, 1);
      const targetTop = Number.isFinite(parsed.scrollTop) && Number(parsed.scrollTop) >= 0
        ? Number(parsed.scrollTop)
        : targetIndex * safeHeight;

      requestAnimationFrame(() => {
        el.scrollTo({ top: targetTop, behavior: "auto" });
      });

      sessionStorage.setItem(
        MOBILE_FEED_RESTORE_KEY,
        JSON.stringify({
          ...parsed,
          index: targetIndex,
          scrollTop: targetTop,
          pending: false,
        })
      );
    } catch {
      sessionStorage.removeItem(MOBILE_FEED_RESTORE_KEY);
    }
  }, [loading, mobileFeedEntries]);

  const [commentsSheetMarket, setCommentsSheetMarket] = useState<{
    marketAddress: string;
    question: string;
  } | null>(null);
  const [commentsCountByMarket, setCommentsCountByMarket] = useState<Record<string, number>>({});

  const openCommentsSheet = useCallback((marketAddress: string, question: string) => {
    if (!marketAddress) return;
    setCommentsSheetMarket({ marketAddress, question });
  }, []);

  const closeCommentsSheet = useCallback(() => {
    setCommentsSheetMarket(null);
  }, []);

  const handleCommentsCountChange = useCallback((marketAddress: string, count: number) => {
    setCommentsCountByMarket((prev) => {
      if (prev[marketAddress] === count) return prev;
      return { ...prev, [marketAddress]: count };
    });
  }, []);

  const railPositionStyle = useMemo(
    () => ({
      top: "calc(env(safe-area-inset-top, 0px) + 76px)",
      bottom: "calc(env(safe-area-inset-bottom, 0px) + 178px)",
    }),
    []
  );

  // ------- MOBILE TRADE SHEET STATE -------
  const [tradeSheetOpen, setTradeSheetOpen] = useState(false);
  const [tradeSheetMarket, setTradeSheetMarket] = useState<typeof prioritizedClassicFeedMarkets[number] | null>(null);
  const [tradeSheetOutcome, setTradeSheetOutcome] = useState(0);

  const openTradeSheet = useCallback(
    (market: typeof prioritizedClassicFeedMarkets[number], outcomeIndex: number) => {
      setTradeSheetMarket(market);
      setTradeSheetOutcome(outcomeIndex);
      setTradeSheetOpen(true);
    },
    []
  );

  /** After a successful buy, update the local market supplies so the feed reflects the new state */
  const handleFeedBuySuccess = useCallback(
    (outcomeIndex: number, deltaShares: number) => {
      if (!tradeSheetMarket) return;
      const pk = tradeSheetMarket.publicKey;

      const updateMarketList = (list: Market[]) =>
        list.map((m) => {
          if (m.publicKey !== pk) return m;
          const updated = { ...m };
          if (updated.outcomeSupplies && updated.outcomeSupplies.length > outcomeIndex) {
            updated.outcomeSupplies = [...updated.outcomeSupplies];
            updated.outcomeSupplies[outcomeIndex] += deltaShares;
          }
          if (outcomeIndex === 0) updated.yesSupply = (updated.yesSupply || 0) + deltaShares;
          if (outcomeIndex === 1) updated.noSupply = (updated.noSupply || 0) + deltaShares;
          return updated;
        });

      setOpenClassicMarkets(updateMarketList);
      setFeaturedClassicMarkets(updateMarketList);
    },
    [tradeSheetMarket]
  );

  // ------- RENDER -------
  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          MOBILE FEED — fullscreen TikTok-like vertical snap scroll
          Only visible below md breakpoint
          ═══════════════════════════════════════════════════════════════ */}
      <div className="md:hidden">
        {loading ? (
          <div className="h-[100dvh] w-full bg-black relative overflow-hidden">
            {/* Shimmer background placeholder */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#0a1a10] via-[#0a0a0a] to-[#0d0d1a]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/60" />

            {/* Top bar skeleton */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-[env(safe-area-inset-top,12px)] h-16">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-full bg-white/10 animate-pulse" />
                <div className="h-4 w-20 rounded bg-white/10 animate-pulse" />
              </div>
              <div className="h-9 w-9 rounded-full bg-white/10 animate-pulse" />
            </div>

            {/* LIVE badge skeleton */}
            <div className="absolute top-20 left-4 z-10">
              <div className="h-7 w-16 rounded-full bg-white/8 animate-pulse" />
            </div>

            {/* Bottom overlay skeleton */}
            <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-[7.5rem]">
              {/* Category badge */}
              <div className="mb-3">
                <div className="h-6 w-20 rounded-full bg-white/10 animate-pulse" />
              </div>
              {/* Title lines */}
              <div className="h-6 w-[85%] rounded bg-white/10 animate-pulse mb-2" />
              <div className="h-6 w-[60%] rounded bg-white/10 animate-pulse mb-3" />
              {/* Sub info row */}
              <div className="flex items-center gap-3 mb-4">
                <div className="h-4 w-4 rounded-full bg-white/10 animate-pulse" />
                <div className="h-3 w-16 rounded bg-white/10 animate-pulse" />
                <div className="h-3 w-16 rounded bg-white/10 animate-pulse" />
                <div className="h-3 w-14 rounded bg-white/10 animate-pulse" />
              </div>
              {/* Outcome buttons skeleton */}
              <div className="flex gap-2">
                <div className="flex-1 h-14 rounded-xl bg-[#00FF87]/15 animate-pulse" />
                <div className="flex-1 h-14 rounded-xl bg-[#ff5c73]/15 animate-pulse" />
              </div>
            </div>
          </div>
        ) : mobileFeedEntries.length === 0 ? (
          <div className="h-[100dvh] flex flex-col items-center justify-center bg-black text-gray-400 gap-4">
            <p className="text-xl">No markets yet</p>
            <Link href="/create" className="px-6 py-3 bg-pump-green text-black font-bold rounded-xl">
              Create one
            </Link>
          </div>
        ) : (
          <div className="relative bg-black">
            {/* Fixed overlay: branding + Search icon */}
            <div className="fixed top-0 left-0 right-0 z-[60] pointer-events-none">
              <div className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top,12px)] h-16">
                <Link href="/" className="pointer-events-auto flex items-center gap-1">
                  <img src="/logo4.png" alt="FunMarket" className="h-10 w-10 object-contain" />
                  <span className="font-semibold text-white text-sm drop-shadow-lg">FunMarket</span>
                </Link>
                <Link
                  href="/search"
                  className="pointer-events-auto h-9 w-9 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm border border-white/15"
                  aria-label="Search markets"
                >
                  <Search className="w-[18px] h-[18px] text-white/90" />
                </Link>
              </div>
            </div>

            {/* Feed container */}
            <div
              ref={mobileFeedRef}
              className="h-[100dvh] overflow-y-auto snap-y snap-mandatory"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <style>{`.md\\:hidden div::-webkit-scrollbar { display: none; }`}</style>
              {mobileFeedEntries.map((entry, index) => {
                const entryKey = mobileFeedEntryKey(entry);
                if (entry.kind === "flash") {
                  const marketAddress = String(entry.market.marketAddress || "").trim();
                  const commentsCount = marketAddress ? commentsCountByMarket[marketAddress] ?? null : null;
                  return (
                    <div
                      key={entryKey}
                      className="relative h-[100dvh] w-full snap-start snap-always flex-shrink-0 overflow-hidden bg-black"
                      onClickCapture={() => saveFeedRestoreState(entryKey, index)}
                    >
                      <FlashMarketCard market={entry.market} variant="hero" className="h-full rounded-none border-0" />
                      <div className="pointer-events-none absolute right-2 z-30 flex items-end" style={railPositionStyle}>
                        <div className="pointer-events-auto">
                          <HomeFeedActionRail
                            marketAddress={marketAddress}
                            marketDbId={entry.market.marketId || null}
                            question={entry.market.question}
                            creatorAddress={null}
                            creatorProfile={null}
                            commentsCount={commentsCount}
                            onOpenComments={() => openCommentsSheet(marketAddress, entry.market.question)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                }

                const market = entry.market;
                const creatorProfile = market.creator ? profilesMap[market.creator] ?? null : null;
                const commentsCount = commentsCountByMarket[market.publicKey] ?? null;
                return (
                  <div key={entryKey} className="relative">
                    <HomeFeedItem
                      market={market as any}
                      liveSessionId={liveMap[market.publicKey] || null}
                      liveMatch={isSportLiveInProgress(market)}
                      finishedMatch={isSportFinishedByProvider(market)}
                      creatorAddress={market.creator}
                      creatorProfile={creatorProfile}
                      withActionRail
                      onTitleTap={() => saveFeedRestoreState(entryKey, index)}
                      onOutcomeTap={(idx) => openTradeSheet(market, idx)}
                    />
                    <div className="pointer-events-none absolute right-2 z-30 flex items-end" style={railPositionStyle}>
                      <div className="pointer-events-auto">
                        <HomeFeedActionRail
                          marketAddress={market.publicKey}
                          marketDbId={market.id || null}
                          question={market.question}
                          creatorAddress={market.creator}
                          creatorProfile={creatorProfile}
                          commentsCount={commentsCount}
                          onOpenComments={() => openCommentsSheet(market.publicKey, market.question)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick trade bottom sheet */}
            <FeedTradeSheet
              open={tradeSheetOpen}
              onClose={() => setTradeSheetOpen(false)}
              market={
                tradeSheetMarket
                  ? {
                      publicKey: tradeSheetMarket.publicKey,
                      dbId: tradeSheetMarket.id,
                      question: tradeSheetMarket.question,
                      creator: tradeSheetMarket.creator,
                      marketType: tradeSheetMarket.marketType,
                      outcomeNames: tradeSheetMarket.outcomeNames,
                      outcomeSupplies: tradeSheetMarket.outcomeSupplies,
                      yesSupply: tradeSheetMarket.yesSupply,
                      noSupply: tradeSheetMarket.noSupply,
                    }
                  : null
              }
              defaultOutcomeIndex={tradeSheetOutcome}
              onBuySuccess={handleFeedBuySuccess}
            />

            <HomeFeedCommentsSheet
              open={!!commentsSheetMarket}
              marketAddress={commentsSheetMarket?.marketAddress ?? null}
              marketQuestion={commentsSheetMarket?.question ?? null}
              initialCount={
                commentsSheetMarket
                  ? commentsCountByMarket[commentsSheetMarket.marketAddress] ?? null
                  : null
              }
              onClose={closeCommentsSheet}
              onCountChange={handleCommentsCountChange}
            />
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          DESKTOP HOME — original home layout (filters, carousel, grid)
          Only visible at md breakpoint and above
          ═══════════════════════════════════════════════════════════════ */}
      <div className="hidden md:block">
        {/* Category Filters - sticky */}
        <div className="border-b border-gray-800 bg-pump-dark/50 sticky top-16 z-30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <CategoryFilters selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />
          </div>
        </div>

        {/* Featured Carousel */}
        <div className="py-6 bg-gradient-to-b from-pump-dark to-transparent">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <h2 className="text-2xl md:text-3xl font-bold text-white">Top markets</h2>
                <p className="text-gray-400 text-sm hidden md:block">Trending predictions with high volume</p>
              </div>

              {/* Desktop arrows */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePrevFeatured}
                  disabled={!carouselSlides.length}
                  className="p-2 bg-black/70 hover:bg-black border border-white/20 hover:border-white/40 rounded-lg transition disabled:opacity-40"
                  aria-label="Previous featured market"
                >
                  <ChevronLeft className="w-5 h-5 text-white" />
                </button>
                <button
                  type="button"
                  onClick={handleNextFeatured}
                  disabled={!carouselSlides.length}
                  className="p-2 bg-black/70 hover:bg-black border border-white/20 hover:border-white/40 rounded-lg transition disabled:opacity-40"
                  aria-label="Next featured market"
                >
                  <ChevronRight className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

            {loading ? (
              <SkeletonFeaturedCard />
            ) : carouselSlides.length > 0 ? (
              <div className="relative">
                <div className="relative overflow-hidden min-h-[400px]">
                  <div
                    className="flex transition-transform duration-500 ease-out h-[400px]"
                    style={{ transform: `translateX(-${currentFeaturedIndex * 100}%)` }}
                  >
                    {carouselSlides.map((slide) => (
                      <div
                        key={slide.kind === "flash" ? `flash-${slide.market.liveMicroId}` : `featured-${slide.market.id}`}
                        className="w-full flex-shrink-0 h-[400px]"
                      >
                        {slide.kind === "flash" ? (
                          <FlashMarketCard market={slide.market} variant="hero" className="h-full" />
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
                    <div className="flex justify-center gap-2 mt-4">
                      {carouselSlides.map((_, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setCurrentFeaturedIndex(index)}
                          className={`h-2 rounded-full transition-all duration-300 ${
                            index === currentFeaturedIndex ? "w-8 bg-white" : "w-2 bg-white/30"
                          }`}
                          aria-label={`Go to featured market ${index + 1}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-20 text-gray-400">
                <p>No featured markets available</p>
              </div>
            )}
          </div>
        </div>

        {/* Markets Grid */}
        <div className="py-8 pb-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-6 gap-3">
              <div>
                <h3 className="text-xl font-bold text-white">{getSectionTitle()}</h3>
                <p className="text-sm text-gray-500">
                  {statusFiltered.length} market{statusFiltered.length !== 1 ? "s" : ""}
                  {statusFilter === "ending_soon" && " ending within 48h"}
                  {statusFilter === "top_volume" && " sorted by volume"}
                </p>
              </div>

              <StatusFilterDropdown value={statusFilter} onChange={setStatusFilter} />
            </div>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : displayedMarkets.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-6xl mb-4">
                  {statusFilter === "ending_soon" ? "⏰" : statusFilter === "top_volume" ? "📊" : "🤷"}
                </div>
                <p className="text-gray-400 text-xl mb-4">
                  {statusFilter === "ending_soon"
                    ? "No markets ending soon"
                    : statusFilter === "top_volume"
                    ? "No active markets with volume"
                    : "No markets found"}
                </p>
                <Link href="/create">
                  <button className="btn-pump">Create the first one!</button>
                </Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
                  {displayedMarkets.map((market, index) => (
                    <motion.div
                      key={market.publicKey}
                      initial={{ opacity: 0, y: 40 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: "-50px" }}
                      transition={{ duration: 0.35, delay: index * 0.03 }}
                      className="h-full"
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
                  <div ref={observerTarget} className="text-center py-12">
                    {loadingMore ? (
                      <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pump-green" />
                    ) : (
                      <button
                        type="button"
                        onClick={loadMore}
                        className="px-8 py-3 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg text-white font-semibold transition"
                      >
                        Load More Markets
                      </button>
                    )}
                  </div>
                )}

                {displayedCount >= statusFiltered.length && statusFiltered.length > 12 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8 text-gray-500 text-sm">
                    You&apos;ve reached the end 🎉
                  </motion.div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
