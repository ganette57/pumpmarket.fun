// src/app/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import MarketCard from "@/components/MarketCard";
import FeaturedMarketCardFull from "@/components/FeaturedMarketCardFull";
import FlashMarketCard from "@/components/FlashMarketCard";
import CategoryFilters from "@/components/CategoryFilters";
import type { SelectedCategory } from "@/components/CategoryFilters";
import { SkeletonCard, SkeletonFeaturedCard } from "@/components/SkeletonCard";
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

type MarketStatusFilter = "all" | "open" | "resolved" | "ending_soon" | "top_volume";
const CAROUSEL_LIMIT = 5;
const FLASH_HOME_POLL_MS = 5_000;

const DEBUG_SPORT_OPEN_FILTER = false;

function isActiveFlashMarket(market: FlashMarket, nowMs = Date.now()): boolean {
  if (!market || market.status !== "active") return false;
  const windowEndMs = Date.parse(String(market.windowEnd || ""));
  return Number.isFinite(windowEndMs) && nowMs < windowEndMs;
}

function sameFlashMarketList(a: FlashMarket[], b: FlashMarket[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.liveMicroId !== right.liveMicroId) return false;
    if (left.marketAddress !== right.marketAddress) return false;
    if (left.status !== right.status) return false;
    if (String(left.windowEnd || "") !== String(right.windowEnd || "")) return false;
    if (String(left.createdAt || "") !== String(right.createdAt || "")) return false;
  }
  return true;
}

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
  const [displayedCount, setDisplayedCount] = useState(12);
  const router = useRouter();
  const sp = useSearchParams();

  // Live session map: market_address -> session id
  const [liveMap, setLiveMap] = useState<Record<string, string>>({});

  // Creator profiles map: wallet_address -> Profile
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});

  const observerTarget = useRef<HTMLDivElement>(null);

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

  // ------- LOAD MARKETS FROM SERVER API (cached) -------
  useEffect(() => {
    void loadMarkets();
  }, []);

  const refreshHomeLiveCryptoFlashMarkets = useCallback(async () => {
    try {
      const response = await fetch("/api/explorer/flash-markets?status=open&kind=crypto&limit=12", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = await response.json();
      const nowMs = Date.now();
      const incoming = Array.isArray(payload?.markets) ? (payload.markets as FlashMarket[]) : [];
      const filtered = incoming.filter((market) => market?.kind === "crypto" && isActiveFlashMarket(market, nowMs));

      setHomeLiveCryptoFlashMarkets((prev) => (sameFlashMarketList(prev, filtered) ? prev : filtered));
      setHomeLiveFlashMarket((prev) => {
        if (!prev || prev.kind !== "crypto") return prev;
        if (isActiveFlashMarket(prev, nowMs) && filtered.some((m) => m.liveMicroId === prev.liveMicroId)) return prev;
        return filtered[0] ?? null;
      });
    } catch {
      // Keep existing list on transient network failures.
    }
  }, []);

  async function loadMarkets() {
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
      await refreshHomeLiveCryptoFlashMarkets();

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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refreshHomeLiveCryptoFlashMarkets();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshHomeLiveCryptoFlashMarkets();
      }
    };

    const timer = window.setInterval(tick, FLASH_HOME_POLL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshHomeLiveCryptoFlashMarkets]);

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

    const scopedFlashSlides = flashSlides.slice(0, CAROUSEL_LIMIT);
    const baseSlides = featuredMarkets.slice(0, Math.max(0, CAROUSEL_LIMIT - scopedFlashSlides.length));
    const mappedBase = baseSlides.map((market) => ({ kind: "featured" as const, market }));
    return [...scopedFlashSlides, ...mappedBase];
  }, [featuredMarkets, homeLiveCryptoFlashMarkets, homeLiveFlashMarket]);

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

  // ------- RENDER -------
  return (
    <>
  

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

            {/* Desktop arrows only */}
            <div className="hidden md:flex gap-2">
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
              {/* DESKTOP: slider - NO extra border wrapper */}
              <div className="hidden md:block relative overflow-hidden min-h-[400px]">
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

                {/* dots - outside the cards */}
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

              {/* MOBILE: swipe (simple scroll-snap) */}
              <div className="md:hidden">
                <div
                  ref={mobileFeaturedRef}
                  onScroll={onMobileScroll}
                  className={[
                    "flex gap-4 overflow-x-auto pb-3",
                    "snap-x snap-mandatory",
                    "[-ms-overflow-style:none] [scrollbar-width:none]",
                    "[&::-webkit-scrollbar]:hidden",
                  ].join(" ")}
                >
                  {carouselSlides.map((slide) => (
                    <div
                      key={slide.kind === "flash" ? `flash-mobile-${slide.market.liveMicroId}` : `featured-mobile-${slide.market.id}`}
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

                {/* dots */}
                {carouselSlides.length > 1 && (
                  <div className="flex justify-center gap-2 mt-2">
                    {carouselSlides.map((_, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => scrollMobileTo(index)}
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
    </>
  );
}
