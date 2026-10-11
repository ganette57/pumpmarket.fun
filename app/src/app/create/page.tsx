"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { usePrivyIdentity } from "@/components/privy/PrivyIdentityProvider";
import { SystemProgram, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useRouter } from "next/navigation";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ArrowLeft, Calendar, Upload, X, Plus, Trash2, Info, AlertTriangle, CheckCircle, Loader2, Search, Trophy } from "lucide-react";
import Image from "next/image";

import { validateMarketQuestion, validateMarketDescription } from "@/utils/bannedWords";
import { CATEGORIES, SPORT_SUBCATEGORIES, isSportSubcategory } from "@/components/CategoryFilters";
import type { CategoryId, SportSubcategoryId } from "@/components/CategoryFilters";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";
import FeedVideoUpload from "@/components/FeedVideoUpload";

import { useProgram } from "@/hooks/useProgram";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { isOfficialFixtureAdmin, getAdminWallets } from "@/lib/adminClient";
import { withMatchPrefix } from "@/lib/sideMarketTitle";
import { indexMarket } from "@/lib/markets";
import { createSportEventServer } from "@/lib/sportEvents";
import { sendSignedTx } from "@/lib/solanaSend";
import { supabase } from "@/lib/supabaseClient";

// Combined category type for create page
type CreateCategoryId = CategoryId | SportSubcategoryId | "";

// Creation steps
type CreationStep = "idle" | "signing" | "confirming" | "indexing" | "done" | "error";

// Resolution sources for sports
const RESOLUTION_SOURCES = [
  { value: "official_league", label: "Official league website" },
  { value: "atp_wta", label: "ATP/WTA official scoreboard" },
  { value: "federation_official", label: "Official federation site" },
  { value: "espn_flashscore", label: "ESPN / Flashscore" },
  { value: "other", label: "Other (specify in notes)" },
] as const;

const T2_MS = 2 * 60_000;
const SPORT_TIMING_MINUTES: Record<string, { durationMin: number; lockMin: number; graceMin: number }> = {
  soccer: { durationMin: 120, lockMin: 112, graceMin: 10 },
  football: { durationMin: 120, lockMin: 112, graceMin: 10 },
  basketball: { durationMin: 175, lockMin: 135, graceMin: 15 },
  nba: { durationMin: 175, lockMin: 135, graceMin: 15 },
  baseball: { durationMin: 180, lockMin: 125, graceMin: 30 },
  mlb: { durationMin: 180, lockMin: 125, graceMin: 30 },
  tennis: { durationMin: 240, lockMin: 238, graceMin: 60 },
  mma: { durationMin: 60, lockMin: 58, graceMin: 30 },
  american_football: { durationMin: 210, lockMin: 208, graceMin: 30 },
};

const DEFAULT_SPORT_TIMING = { durationMin: 240, lockMin: 238, graceMin: 30 };

function getSportTiming(sport: string) {
  const key = String(sport || "").trim().toLowerCase();
  return SPORT_TIMING_MINUTES[key] || DEFAULT_SPORT_TIMING;
}

function estimateMatchTimes(startDate: Date, sport: string) {
  const timing = getSportTiming(sport);
  const endTime = new Date(startDate.getTime() + timing.durationMin * 60_000);
  const lockAt = new Date(startDate.getTime() + timing.lockMin * 60_000);
  const endedTime = new Date(endTime.getTime() + timing.graceMin * 60_000);
  return { endTime, lockAt, endedTime, timing };
}

function estimateMatchEnd(startDate: Date, sport: string): Date {
  return estimateMatchTimes(startDate, sport).endTime;
}

function isValidIanaTimeZone(tz?: string | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function hasExplicitTimeZone(input: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(input.trim());
}

function zonedLocalToUtcMs(localDateTime: string, timeZone: string): number {
  const m = localDateTime
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s])(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || "0");

  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(new Date(guessUtcMs));
  const byType = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const interpretedMs = Date.UTC(
    Number(byType("year")),
    Number(byType("month")) - 1,
    Number(byType("day")),
    Number(byType("hour")),
    Number(byType("minute")),
    Number(byType("second"))
  );

  const offsetMs = interpretedMs - guessUtcMs;
  return guessUtcMs - offsetMs;
}

function extractEventTimeZone(m: any): string | null {
  const candidates = [
    m?.event_timezone,
    m?.timezone,
    m?.raw?.timezone,
    m?.raw?.tz,
    m?.raw?.fixture?.timezone,
  ];
  for (const tz of candidates) {
    const next = String(tz || "").trim();
    if (isValidIanaTimeZone(next)) return next;
  }
  return null;
}

function parseEventStartDate(startTime: unknown, eventTimeZone?: string | null): Date | null {
  if (typeof startTime === "number") {
    const ms = startTime > 1_000_000_000_000 ? startTime : startTime * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  if (typeof startTime !== "string" || !startTime.trim()) return null;
  const raw = startTime.trim();

  if (hasExplicitTimeZone(raw)) {
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  if (isValidIanaTimeZone(eventTimeZone)) {
    const utcMs = zonedLocalToUtcMs(raw, eventTimeZone);
    if (Number.isFinite(utcMs)) return new Date(utcMs);
  }

  const utcGuess = new Date(`${raw}Z`);
  return Number.isFinite(utcGuess.getTime()) ? utcGuess : null;
}

function formatYourTime(utcDate: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(utcDate);
}

function formatMatchTime(utcDate: Date, eventTimeZone?: string | null): string {
  if (!isValidIanaTimeZone(eventTimeZone)) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(utcDate);
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: eventTimeZone,
    timeZoneName: "short",
  }).format(utcDate);
}

// ---------- helpers ----------
function parseOutcomes(text: string) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function toStringArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(String).map((s) => s.trim()).filter(Boolean);
  return [];
}

function outcomesToText(arr: string[]) {
  return (arr || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 10)
    .join("\n");
}

function isSoccerLikeSport(sport: unknown): boolean {
  const s = String(sport || "").trim().toLowerCase();
  return s === "soccer" || s === "football";
}

function buildMatchOutcomes(homeTeam: unknown, awayTeam: unknown, sport: unknown): string[] {
  const home = String(homeTeam || "").trim() || "Home";
  const away = String(awayTeam || "").trim() || "Away";
  const base = [home];
  if (isSoccerLikeSport(sport)) {
    base.push("Draw");
  }
  base.push(away);
  const seen = new Set<string>();
  return base.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractProviderMatchImageUrl(m: any): string | null {
  const candidates = [
    m?.image_url,
    m?.imageUrl,
    m?.thumbnail,
    m?.thumb,
    m?.raw?.event_image,
    m?.raw?.event_thumb,
    m?.raw?.event_poster,
    m?.raw?.event_banner,
    m?.raw?.event_square,
    m?.raw?.strThumb,
    m?.raw?.strPoster,
    m?.raw?.strBanner,
    m?.raw?.strSquare,
  ];
  for (const candidate of candidates) {
    const url = String(candidate || "").trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}

function pickerSportFromCategory(category: unknown): string | null {
  const key = String(category || "").trim().toLowerCase();
  if (!key) return null;
  if (key === "soccer" || key === "football") return "soccer";
  if (key === "basketball" || key === "nba") return "basketball";
  if (key === "baseball" || key === "mlb") return "baseball";
  if (key === "american_football" || key === "nfl") return "american_football";
  if (key === "tennis") return "tennis";
  return null;
}

function TypeCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left rounded-2xl border p-4 transition",
        active
          ? "border-pump-green bg-pump-green/10"
          : "border-white/10 bg-pump-dark/40 hover:border-white/20",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-white font-bold">{title}</div>
        {active && (
          <span className="px-2 py-1 rounded-full text-xs font-semibold border border-pump-green/40 bg-pump-green/10 text-pump-green">
            Selected
          </span>
        )}
      </div>
      <div className="text-sm text-gray-400 mt-1">{desc}</div>
    </button>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
      <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-blue-200">{children}</div>
    </div>
  );
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
      <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-yellow-200">{children}</div>
    </div>
  );
}

const CATEGORY_ICONS: Partial<Record<CategoryId, string>> = {
  sports: "⚽",
  crypto: "₿",
  politics: "🏛️",
  gaming: "🎮",
  esport: "🕹️",
  finance: "📈",
  entertainment: "🎬",
  celebrity: "⭐",
  tech: "💻",
  science: "🧪",
  culture: "🎭",
  fun: "🎉",
  other: "•••",
};

function WizardProgress({ activeStep }: { activeStep: number }) {
  return (
    <div className="grid grid-cols-4 gap-2" aria-label={`Step ${activeStep} of 4`}>
      {[1, 2, 3, 4].map((step) => (
        <div
          key={step}
          className={`h-1 rounded-full transition-colors ${
            step <= activeStep ? "bg-pump-green" : "bg-white/15"
          }`}
        />
      ))}
    </div>
  );
}

function CategoryStep({
  category,
  onSelect,
  onNext,
  onClose,
}: {
  category: CreateCategoryId;
  onSelect: (category: CreateCategoryId) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const sportsSelected = category === "sports" || isSportSubcategory(category);
  const sportsCategory = CATEGORIES.find((item) => item.id === "sports");
  const regularCategories = CATEGORIES.filter(
    (item) => item.id !== "all" && item.id !== "sports"
  );
  const sportOptions = [
    { id: "sports" as const, label: "General" },
    ...SPORT_SUBCATEGORIES.filter((sport) => sport.id !== "tennis").map((sport) => ({
      id: sport.id,
      label: sport.id === "soccer" ? "Football" : sport.label,
    })),
  ];
  const renderSportSelector = (className: string) =>
    sportsSelected ? (
      <div className={`col-span-full py-1 ${className}`}>
        <p className="mb-2 text-xs font-medium text-gray-500">Choose a sport</p>
        <div className="flex flex-wrap gap-2">
          {sportOptions.map((sport) => {
            const selected = category === sport.id;
            return (
              <button
                key={sport.id}
                type="button"
                onClick={() => onSelect(sport.id)}
                aria-pressed={selected}
                className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                  selected
                    ? "border-pump-green bg-pump-green text-black"
                    : "border-white/10 bg-white/[0.035] text-gray-300 hover:border-white/25 hover:text-white"
                }`}
              >
                {sport.label}
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-black px-4 pb-48 pt-5 sm:px-6 md:min-h-[calc(100vh-5rem)] md:pb-32 md:pt-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close create market"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <WizardProgress activeStep={1} />
          </div>
          <div className="h-10 w-10 shrink-0" aria-hidden="true" />
        </div>

        <div className="mt-9 sm:mt-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pump-green">
            Step 1 of 4
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Create your market
          </h1>
          <p className="mt-3 text-base text-gray-400 sm:text-lg">
            What do you want people to predict?
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {sportsCategory && (
            <button
              type="button"
              onClick={() => onSelect("sports")}
              aria-pressed={sportsSelected}
              className={`flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                sportsSelected
                  ? "border-pump-green bg-pump-green/10 text-white shadow-[0_0_24px_rgba(34,197,94,0.08)]"
                  : "border-white/10 bg-white/[0.035] text-gray-200 hover:border-white/25 hover:bg-white/[0.06]"
              }`}
            >
              <span className="text-2xl" aria-hidden="true">{CATEGORY_ICONS.sports}</span>
              <span className="font-semibold">{sportsCategory.label}</span>
            </button>
          )}

          {regularCategories.map((item) => {
            const selected = category === item.id;
            const label = item.id === "esport" ? "Esports" : item.label;
            return (
              <Fragment key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-pressed={selected}
                  className={`flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-pump-green bg-pump-green/10 text-white shadow-[0_0_24px_rgba(34,197,94,0.08)]"
                      : "border-white/10 bg-white/[0.035] text-gray-200 hover:border-white/25 hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="text-2xl" aria-hidden="true">{CATEGORY_ICONS[item.id]}</span>
                  <span className="font-semibold">{label}</span>
                </button>
                {item.id === "politics" && renderSportSelector("sm:hidden")}
                {item.id === "finance" && renderSportSelector("hidden sm:block")}
              </Fragment>
            );
          })}
        </div>
      </div>

      <div className="fixed bottom-[6.25rem] left-0 right-0 z-40 px-4 md:bottom-14 md:px-6">
        <div className="mx-auto max-w-2xl rounded-2xl bg-black/90 pt-3 backdrop-blur-xl">
          <button
            type="button"
            onClick={onNext}
            disabled={!category}
            className={`w-full rounded-xl py-4 text-base font-bold transition ${
              category
                ? "bg-pump-green text-black shadow-[0_0_28px_rgba(34,197,94,0.2)] hover:brightness-105"
                : "cursor-not-allowed bg-white/10 text-gray-600"
            }`}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Match Picker Modal ----------
function MatchPickerModal({
  open,
  onClose,
  onSelectMatch,
  sportType,
  onSportTypeChange,
  excludeOfficial = false,
}: {
  open: boolean;
  onClose: () => void;
  onSelectMatch: (m: any) => void;
  sportType: string;
  onSportTypeChange: (s: string) => void;
  /** Admin official picker: hide fixtures that already have an official market. */
  excludeOfficial?: boolean;
}) {
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  // Reset state when sport changes
  useEffect(() => {
    setFixtures([]);
    setLoaded(false);
    setFilter("");
    setError("");
  }, [sportType]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setFilter("");
      setError("");
    }
  }, [open]);

  async function handleLoad() {
    if (loading) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/sports/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport: sportType, exclude_official: excludeOfficial }),
      });

      if (res.status === 429) {
        setError("Rate limit reached. Try again later.");
        return;
      }

      if (res.ok) {
        const json = await res.json();
        const matches = json.matches || [];
        setFixtures(matches);
        setLoaded(true);
        if (matches.length === 0) {
          setError("No upcoming matches found for this sport.");
        }
      } else {
        setError("Failed to load matches.");
      }
    } catch {
      setError("Failed to load matches.");
    } finally {
      setLoading(false);
    }
  }

  // Group by day
  const fixturesByDay = useMemo(() => {
    const filtered = fixtures.filter((m: any) => {
      if (!filter.trim()) return true;
      const lq = filter.toLowerCase();
      const hay = `${m.home_team} ${m.away_team} ${m.league}`.toLowerCase();
      return hay.includes(lq);
    });
    const groups: { label: string; matches: any[] }[] = [];
    const dayMap = new Map<string, any[]>();
    for (const m of filtered) {
      const d = parseEventStartDate(m.start_time, extractEventTimeZone(m));
      if (!d) continue;
      const key = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      if (!dayMap.has(key)) dayMap.set(key, []);
      dayMap.get(key)!.push(m);
    }
    dayMap.forEach((matches, label) => groups.push({ label, matches }));
    return groups;
  }, [fixtures, filter]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[#0a0b0d] border border-gray-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-5 h-5 text-pump-green" />
            <h3 className="text-lg font-bold text-white">Pick a match</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Sport selector + Load */}
        <div className="p-4 border-b border-gray-800 space-y-3">
          <div className="flex items-center gap-3">
            <select
              value={sportType}
              onChange={(e) => onSportTypeChange(e.target.value)}
              className="input-pump flex-1"
            >
              <option value="soccer">Soccer</option>
              <option value="basketball">Basketball</option>
              <option value="baseball">Baseball</option>
              <option value="american_football">American Football</option>
            </select>
            <button
              type="button"
              onClick={handleLoad}
              disabled={loading}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 bg-pump-green text-black hover:opacity-90 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {loaded ? "Reload" : "Load"}
            </button>
          </div>

          {/* Filter (only when loaded) */}
          {loaded && fixtures.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="input-pump w-full pl-9 text-sm"
                placeholder="Filter by team or league..."
              />
            </div>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!loaded && !loading && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Trophy className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Select a sport and click Load</p>
              <p className="text-xs mt-1 text-gray-600">Next 7 days of matches</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading upcoming matches...
            </div>
          )}

          {error && (
            <p className="text-xs text-yellow-400 text-center py-4 px-4">{error}</p>
          )}

          {loaded && fixtures.length > 0 && (
            <>
              {fixturesByDay.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-6">No matches match your filter.</p>
              )}
              {fixturesByDay.map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 px-4 py-1.5 bg-[#0a0b0d]/95 border-b border-white/10 backdrop-blur-sm">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                      {group.label}
                    </span>
                  </div>
                  {group.matches.map((m: any) => {
                    const eventTz = extractEventTimeZone(m);
                    const d = parseEventStartDate(m.start_time, eventTz);
                    const yourTime = d ? formatYourTime(d) : "--:--";
                    const matchTime = d ? formatMatchTime(d, eventTz) : "Time unavailable";
                    const timezoneUnknown =
                      !isValidIanaTimeZone(eventTz) &&
                      typeof m.start_time === "string" &&
                      m.start_time.trim().length > 0 &&
                      !hasExplicitTimeZone(m.start_time);
                    return (
                      <button
                        key={m.provider_event_id}
                        type="button"
                        onClick={() => {
                          onSelectMatch(m);
                          onClose();
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-white/5 transition border-b border-white/5 last:border-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white truncate">
                            {m.home_team} vs {m.away_team}
                          </span>
                          <span className="text-[10px] font-mono text-gray-500 flex-shrink-0 bg-white/5 px-1.5 py-0.5 rounded">
                            {d ? yourTime : "N/A"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400 truncate">{m.league}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                          <span>Your time: {yourTime}</span>
                          <span>{isValidIanaTimeZone(eventTz) ? `Match time: ${matchTime}` : `UTC: ${matchTime}`}</span>
                          {timezoneUnknown && <span className="text-yellow-400">timezone unknown</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Creation Modal ----------
function CreationModal({
  step,
  error,
  onClose,
  marketAddress,
}: {
  step: CreationStep;
  error: string | null;
  onClose: () => void;
  marketAddress?: string | null;
}) {
  if (step === "idle") return null;

  const steps = [
    { key: "signing", label: "Sign transaction" },
    { key: "confirming", label: "Confirming on Solana" },
    { key: "indexing", label: "Indexing market" },
  ];

  const currentIndex = steps.findIndex((s) => s.key === step);
  const isDone = step === "done";
  const isError = step === "error";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-[#0a0b0d] border border-gray-800 rounded-2xl p-6 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          {isDone ? (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-pump-green/20 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-pump-green" />
              </div>
              <h3 className="text-xl font-bold text-white">Market Created!</h3>
              <p className="text-gray-400 text-sm mt-1">Redirecting to your market...</p>
            </>
          ) : isError ? (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <X className="w-10 h-10 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-white">Creation Failed</h3>
              <p className="text-red-400 text-sm mt-2">{error || "Something went wrong"}</p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-pump-green/20 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-pump-green animate-spin" />
              </div>
              <h3 className="text-xl font-bold text-white">Creating Market...</h3>
              <p className="text-gray-400 text-sm mt-1">Please wait, don't close this page</p>
            </>
          )}
        </div>

        {/* Steps */}
        {!isDone && !isError && (
          <div className="space-y-3 mb-6">
            {steps.map((s, idx) => {
              const isActive = s.key === step;
              const isComplete = idx < currentIndex;
              const isPending = idx > currentIndex;

              return (
                <div
                  key={s.key}
                  className={`flex items-center gap-3 p-3 rounded-lg transition ${
                    isActive ? "bg-pump-green/10 border border-pump-green/30" : "bg-white/5"
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isComplete
                        ? "bg-pump-green text-black"
                        : isActive
                        ? "bg-pump-green/20 text-pump-green"
                        : "bg-gray-700 text-gray-500"
                    }`}
                  >
                    {isComplete ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : isActive ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <span className="text-xs font-bold">{idx + 1}</span>
                    )}
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      isComplete ? "text-pump-green" : isActive ? "text-white" : "text-gray-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Done: manual fallback in case the auto-redirect doesn't fire */}
        {isDone && marketAddress && (
          <a
            href={`/trade/${marketAddress}`}
            className="block w-full py-3 rounded-lg bg-pump-green text-black font-semibold text-center hover:bg-pump-green/90 transition"
          >
            View market →
          </a>
        )}

        {/* Error close button */}
        {isError && (
          <button
            onClick={onClose}
            className="w-full py-3 rounded-lg bg-white/10 text-white font-semibold hover:bg-white/20 transition"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

export default function CreateMarketPage() {
  const { publicKey, connected, connecting, signTransaction } = useFunMarketWallet();
  // Sign-in entry point only. Product rules below (Real-only creation,
  // canSubmit, validation) are unchanged.
  const privy = usePrivyIdentity();
  const { connection } = useConnection();
  const router = useRouter();
  const program = useProgram();
  // Play mode leaves this page fully visible but blocks submission.
  const { isPlay: isPlayMode } = useTradingMode();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [activeMediaPanel, setActiveMediaPanel] = useState<"image" | "video" | null>(null);
  const [dateTimePicker, setDateTimePicker] = useState<"date" | "time" | null>(null);
  const [draftDateTime, setDraftDateTime] = useState<Date | null>(null);
  const selectedTimeOptionRef = useRef<HTMLButtonElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [creationStep, setCreationStep] = useState<CreationStep>("idle");
  const [creationError, setCreationError] = useState<string | null>(null);
  const [createdMarketAddress, setCreatedMarketAddress] = useState<string | null>(null);

  // Tx guard: prevent double-submit
  const inFlightRef = useRef<Record<string, boolean>>({});

  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CreateCategoryId>("");

  const [marketType, setMarketType] = useState<0 | 1>(0); // 0=binary, 1=multi
  const [outcomesText, setOutcomesText] = useState("YES\nNO");
  const [outcomeInputs, setOutcomeInputs] = useState<string[]>(["YES", "NO"]);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageError, setImageError] = useState<string>("");
  const [imageManuallyEdited, setImageManuallyEdited] = useState(false);

  const [resolutionDate, setResolutionDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  });

  const [feedVideoFile, setFeedVideoFile] = useState<File | null>(null);
  const [feedVideoPreview, setFeedVideoPreview] = useState<string>("");
  const [feedVideoThumbnail, setFeedVideoThumbnail] = useState<Blob | null>(null);

  const [questionError, setQuestionError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  // Sports-specific fields
  const [resolutionSource, setResolutionSource] = useState<string>("official_league");
  const [proofLink, setProofLink] = useState<string>("");

  useEffect(() => {
    if (dateTimePicker !== "time") return;
    const frame = requestAnimationFrame(() => {
      selectedTimeOptionRef.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [dateTimePicker]);

  // Sport event fields (for sport_events table)
  const [sportHomeTeam, setSportHomeTeam] = useState("");
  const [sportAwayTeam, setSportAwayTeam] = useState("");
  const [sportType, setSportType] = useState<string>("soccer");
  const [sportStartTime, setSportStartTime] = useState<Date | null>(null);
  const [sportEndTime, setSportEndTime] = useState<Date | null>(null);
  const [sportLeague, setSportLeague] = useState("");
  const [sportProviderEventId, setSportProviderEventId] = useState("");
  const [sportProviderName, setSportProviderName] = useState("");
  const [sportRaw, setSportRaw] = useState<any>(null);
  const [sportEventTimezone, setSportEventTimezone] = useState<string>("");

  // Match picker modal
  const [matchPickerOpen, setMatchPickerOpen] = useState(false);

  // A sport SUBCATEGORY (soccer, basketball, ...) is selected. The top-level
  // "Sports (General)" category now behaves like any normal category.
  const isSportSubcategorySelected =
    category !== "" && isSportSubcategory(category);

  // Used only for the "appears under Sports → ..." hint.
  const isSportsMarket = category === "sports" || isSportSubcategorySelected;

  // ── Official fixture picking is admin-only ──────────────────────────────
  // Wallet may be undefined on first render / during autoConnect. Never treat
  // "publicKey === null" as a definitive "disconnected" — fold the
  // initializing window into a loading state so the UI doesn't flicker/hide.
  const walletBase58 = publicKey?.toBase58() ?? null;
  const isFixtureAdmin = isOfficialFixtureAdmin(walletBase58);

  // ── Match flows ─────────────────────────────────────────────────────────
  // OFFICIAL (admin): sport subcategory + admin wallet → frozen official flow
  //   (provider fixture, live sport_event, near-end auto-lock). DO NOT CHANGE.
  //   `isMatchMode` now means "official admin match flow" — every existing
  //   match-only field keys off it and therefore stays admin-only.
  // SIDE MARKET (user): sport subcategory + non-admin → simplified flow whose
  //   trading ends at kickoff and creates NO live sport_event.
  const isMatchMode = isSportSubcategorySelected && isFixtureAdmin;
  const sideMarketMode = isSportSubcategorySelected && !isFixtureAdmin;
  const hasLinkedFixture = isMatchMode && sportProviderEventId.trim().length > 0;

  // Temporary debug logs (development only)
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    console.log("[create] wallet/admin state", {
      connected,
      connecting,
      publicKey: walletBase58,
      adminAllowlist: getAdminWallets(),
      isOfficialFixtureAdmin: isFixtureAdmin,
      category,
    });
  }, [connected, connecting, walletBase58, isFixtureAdmin, category]);

  // On-chain defaults (hidden from user)
  const DEFAULT_B_SOL = 0.01;
  const DEFAULT_MAX_POSITION_BPS = 10_000;
  const DEFAULT_MAX_TRADE_SHARES = 5_000_000;
  const DEFAULT_COOLDOWN_SECONDS = 0;

  // When switching to sports match category, set default outcomes
  useEffect(() => {
    if (isMatchMode && marketType === 0) {
      setOutcomeInputs(["Team A", "Team B"]);
    }
  }, [isMatchMode]);

  // when switching type: reset/ensure valid outcomes UI
  useEffect(() => {
    if (marketType === 0) {
      if (isMatchMode) {
        setOutcomeInputs(["Team A", "Team B"]);
      } else {
        setOutcomeInputs(["YES", "NO"]);
      }
    } else {
      setOutcomeInputs((prev) => {
        const cleaned = (prev || []).map((s) => String(s || "").trim()).filter(Boolean);
        if (cleaned.length >= 2) return cleaned.slice(0, 10);
        return ["Option 1", "Option 2"];
      });
    }
  }, [marketType, isMatchMode]);

  // sync: outcomeInputs -> outcomesText
  useEffect(() => {
    const txt = outcomesToText(outcomeInputs);
    const defaultTxt = isMatchMode ? "Team A\nTeam B" : "YES\nNO";
    setOutcomesText(txt || (marketType === 0 ? defaultTxt : "Option 1\nOption 2"));
  }, [outcomeInputs, marketType, isMatchMode]);

  const outcomes = useMemo(() => parseOutcomes(outcomesText), [outcomesText]);

  const outcomesError = useMemo(() => {
    if (marketType === 0) return outcomes.length === 2 ? null : "Binary must have exactly 2 outcomes.";
    return outcomes.length >= 2 && outcomes.length <= 10 ? null : "Multi-choice must have 2 to 10 outcomes.";
  }, [marketType, outcomes.length]);

  const canSubmit =
    connected &&
    !!publicKey &&
    !!program &&
    question.trim().length >= 10 &&
    !questionError &&
    !descriptionError &&
    !outcomesError &&
    !!category && // Category is required
    !!resolutionDate &&
    resolutionDate > new Date() &&
    // Side markets require a selected fixture (kickoff drives the end date).
    (!sideMarketMode || sportProviderEventId.trim().length > 0);

  const handleQuestionChange = (value: string) => {
    setQuestion(value);
    const v = validateMarketQuestion(value);
    setQuestionError(v.valid ? null : v.error || null);
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    const v = validateMarketDescription(value);
    setDescriptionError(v.valid ? null : v.error || null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) return setImageError("Image must be less than 5MB");
    if (!file.type.startsWith("image/")) return setImageError("File must be an image");

    setImageError("");
    setImageFile(file);
    setImageManuallyEdited(true);

    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview("");
    setImageError("");
    setImageManuallyEdited(true);
  };

  function updateOutcomeAt(i: number, value: string) {
    setOutcomeInputs((prev) => {
      const next = prev.slice();
      next[i] = value;
      return next;
    });
  }

  function addOutcome() {
    setOutcomeInputs((prev) => {
      if (prev.length >= 10) return prev;
      const next = prev.slice();
      next.push(`Option ${next.length + 1}`);
      return next;
    });
  }

  function removeOutcome(i: number) {
    setOutcomeInputs((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.slice();
      next.splice(i, 1);
      return next;
    });
  }

  // Build full description with sports metadata
  function buildFullDescription(): string {
    let desc = description || "";

    if (isMatchMode) {
      const parts: string[] = [];

      const sourceLabel = RESOLUTION_SOURCES.find((s) => s.value === resolutionSource)?.label || resolutionSource;
      parts.push(`Resolution source: ${sourceLabel}`);

      if (proofLink.trim()) {
        parts.push(`Proof: ${proofLink.trim()}`);
      }

      if (parts.length > 0) {
        desc = desc ? `${desc}\n\n---\n${parts.join("\n")}` : parts.join("\n");
      }
    }

    return desc;
  }

  function closeCreationModal() {
    setCreationStep("idle");
    setCreationError(null);
  }

  function selectMatch(m: any) {
    const eventTimeZone = extractEventTimeZone(m);
    const selectedSport = String(m.sport || sportType || "").toLowerCase();
    setSportType(m.sport || sportType);
    setSportHomeTeam(m.home_team);
    setSportAwayTeam(m.away_team);
    setSportLeague(m.league || "");
    setSportProviderEventId(m.provider_event_id || "");
    setSportProviderName(m.provider || "");
    setSportRaw(m.raw ?? null);
    setSportEventTimezone(eventTimeZone || "");

    // Track match start_time from absolute UTC or timezone-aware conversion (never local-guess from raw local string).
    const matchStart = parseEventStartDate(m.start_time, eventTimeZone);
    if (matchStart) setSportStartTime(matchStart);

    // Keep trading close at T-2 while storing event end_time as actual match end.
    if (matchStart) {
      const estimatedTimes = estimateMatchTimes(matchStart, selectedSport);
      setSportEndTime(estimatedTimes.endTime);
      setResolutionDate(estimatedTimes.lockAt);
    } else if (m.end_time) {
      const endDate = new Date(m.end_time);
      if (Number.isFinite(endDate.getTime())) {
        setResolutionDate(endDate);
        setSportEndTime(new Date(endDate.getTime() + T2_MS));
      }
    }

    setQuestion(`${m.home_team} vs ${m.away_team}${m.league ? ` - ${m.league}` : ""}`);
    if (!imageManuallyEdited) {
      const providerImageUrl = extractProviderMatchImageUrl(m);
      if (providerImageUrl) {
        setImageFile(null);
        setImageError("");
        setImagePreview(providerImageUrl);
      }
    }

    if (isSoccerLikeSport(selectedSport)) {
      if (marketType === 0) setMarketType(1);
      setOutcomeInputs(buildMatchOutcomes(m.home_team, m.away_team, selectedSport));
    } else if (marketType === 0) {
      setOutcomeInputs(buildMatchOutcomes(m.home_team, m.away_team, selectedSport).slice(0, 2));
    }
  }

  function clearSelectedMatch() {
    setSportProviderEventId("");
    setSportProviderName("");
    setSportEventTimezone("");
    setSportHomeTeam("");
    setSportAwayTeam("");
    setSportLeague("");
    setSportStartTime(null);
    setSportEndTime(null);
    setSportRaw(null);
    setQuestion("");
    if (marketType === 0) {
      setOutcomeInputs(["Team A", "Team B"]);
    }
  }

  function openMatchPicker() {
    const mappedSport = pickerSportFromCategory(category);
    if (mappedSport) setSportType(mappedSport);
    setMatchPickerOpen(true);
  }

  // ── Side market fixture selection (normal users) ────────────────────────
  // Sets ONLY the hidden fixture metadata + kickoff. It deliberately does NOT
  // touch question / outcomes / marketType (the user writes those) and does
  // NOT compute the official near-end lock — side markets end at kickoff.
  function selectSideMatch(m: any) {
    const eventTimeZone = extractEventTimeZone(m);
    setSportType(m.sport || sportType);
    setSportHomeTeam(m.home_team || "");
    setSportAwayTeam(m.away_team || "");
    setSportLeague(m.league || "");
    setSportProviderEventId(m.provider_event_id || "");
    setSportProviderName(m.provider || "");
    setSportRaw(m.raw ?? null);
    setSportEventTimezone(eventTimeZone || "");

    const matchStart = parseEventStartDate(m.start_time, eventTimeZone);
    if (matchStart) {
      setSportStartTime(matchStart);
      // Side market: trading lock / end date = kickoff.
      setResolutionDate(matchStart);
    }

    // Use the provider artwork as the market image unless the user set one.
    if (!imageManuallyEdited) {
      const providerImageUrl = extractProviderMatchImageUrl(m);
      if (providerImageUrl) {
        setImageFile(null);
        setImageError("");
        setImagePreview(providerImageUrl);
      }
    }

    setMatchPickerOpen(false);
  }

  function clearSideMatch() {
    setSportProviderEventId("");
    setSportProviderName("");
    setSportEventTimezone("");
    setSportHomeTeam("");
    setSportAwayTeam("");
    setSportLeague("");
    setSportStartTime(null);
    setSportEndTime(null);
    setSportRaw(null);
  }

  async function handleCreateMarket() {
    // Guard the handler too, not just the button: creation is on-chain and
    // must never run while the app is in Play mode.
    if (isPlayMode) return;
    if (!canSubmit || !publicKey || !program) return;
    if (!signTransaction) {
      setCreationError("Wallet cannot sign transactions");
      setCreationStep("error");
      return;
    }

    const key = "create_market";
    if (inFlightRef.current[key]) return;
    inFlightRef.current[key] = true;
    setLoading(true);
    setCreationStep("signing");
    setCreationError(null);

    try {
      const marketKeypair = Keypair.generate();

      const hasLinkedProviderFixture = isMatchMode && sportProviderEventId.trim().length > 0;

      // For sport markets: ensure resolution time = sport end (T-2), not match start
      // Safety: if resolutionDate somehow ended up <= sportStartTime, recompute
      let effectiveEndDate = resolutionDate;
      let persistedMatchStart: Date | null = null;
      let persistedMatchEnd: Date | null = null;
      if (sideMarketMode && sportStartTime) {
        // SIDE MARKET (user): trading lock / resolution = kickoff. No live
        // sport_event, no near-end auto-lock. Independent of official timing.
        effectiveEndDate = sportStartTime;
      } else if (hasLinkedProviderFixture && sportStartTime) {
        persistedMatchStart = sportStartTime;
        const estimatedTimes = estimateMatchTimes(sportStartTime, sportType);
        persistedMatchEnd = estimatedTimes.endTime;
        effectiveEndDate = estimatedTimes.lockAt;
      } else if (isMatchMode && sportStartTime && resolutionDate.getTime() <= sportStartTime.getTime()) {
        const estimatedTimes = estimateMatchTimes(sportStartTime, sportType);
        effectiveEndDate = estimatedTimes.lockAt;
        console.warn("[create] resolutionDate <= sportStartTime, recomputed to", effectiveEndDate.toISOString());
      }

      const resolutionTimestamp = Math.floor(effectiveEndDate.getTime() / 1000);
      const bLamportsU64 = Math.floor(DEFAULT_B_SOL * 1_000_000_000);

      const tx = await (program as any).methods
        .createMarket(
          new BN(resolutionTimestamp),
          outcomes,
          marketType,
          new BN(bLamportsU64),
          DEFAULT_MAX_POSITION_BPS,
          new BN(DEFAULT_MAX_TRADE_SHARES),
          new BN(DEFAULT_COOLDOWN_SECONDS)
        )
        .accounts({
          market: marketKeypair.publicKey,
          creator: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      setCreationStep("confirming");

      const txSig = await sendSignedTx({
        connection,
        tx,
        feePayer: publicKey,
        signTx: signTransaction,
        beforeSign: (t) => t.partialSign(marketKeypair),
      });

      console.log("Market created! tx:", txSig);

      setCreationStep("indexing");

      let onchainType = Number(marketType) || 0;
      let onchainNames = outcomes;
      let onchainSupplies: number[] = new Array(outcomes.length).fill(0);

      try {
        const acct: any = await (program as any).account.market.fetch(marketKeypair.publicKey);
        onchainType = Number(acct?.marketType ?? acct?.market_type ?? onchainType) || 0;

        const namesA = toStringArray(acct?.outcomeNames);
        const namesB = toStringArray(acct?.outcome_names);
        if (namesA.length) onchainNames = namesA;
        else if (namesB.length) onchainNames = namesB;

        if (Array.isArray(acct?.q)) {
          const qNums = acct.q.map((v: any) => Number(v) || 0);
          onchainSupplies = qNums.slice(0, onchainNames.length);
        }
      } catch (fetchErr) {
        console.warn("Could not fetch on-chain market (still ok):", fetchErr);
      }

      const isBinary = onchainType === 0 && onchainNames.length === 2;
      const fullDescription = buildFullDescription();

      // If sport MATCH market, create sport_events row via server endpoint
      // Skip for "general" sports questions (no match data)
      let sportEventId: string | undefined;
      let sportMeta: Record<string, unknown> | undefined;
      let dbStartTimeIso: string | undefined;
      let dbEndTimeIso: string | undefined;
      const selectedSport = String(sportType || "").trim().toLowerCase();
      const hasRealSportsFixture = isMatchMode && hasLinkedFixture;
      const persistedSport = hasRealSportsFixture ? selectedSport : null;
      if (isMatchMode && sportHomeTeam.trim() && sportAwayTeam.trim()) {
        // Store real match end_time on sport_events (UTC ISO), while market end_date stays T-2.
        const matchStart = persistedMatchStart || sportStartTime || resolutionDate;
        const matchEnd = persistedMatchEnd || sportEndTime || estimateMatchEnd(matchStart, sportType);
        dbStartTimeIso = matchStart.toISOString();
        dbEndTimeIso = matchEnd.toISOString();

        const evt = await createSportEventServer({
          provider: sportProviderEventId ? (sportProviderName || "thesportsdb") : "manual",
          provider_event_id: sportProviderEventId || `manual_${marketKeypair.publicKey.toBase58()}`,
          sport: sportType,
          home_team: sportHomeTeam.trim(),
          away_team: sportAwayTeam.trim(),
          start_time: dbStartTimeIso,
          end_time: dbEndTimeIso,
          league: sportLeague || undefined,
          raw: sportRaw ?? undefined,
        });
        sportEventId = evt.id;
        sportMeta = {
          sport: persistedSport,
          provider: sportProviderEventId ? (sportProviderName || "thesportsdb") : "manual",
          provider_event_id: sportProviderEventId || undefined,
          home_team: sportHomeTeam.trim(),
          away_team: sportAwayTeam.trim(),
          start_time: dbStartTimeIso,
          end_time: dbEndTimeIso,
          raw: sportRaw ?? undefined,
        };
      }

      // SIDE MARKET (user): store fixture metadata WITHOUT creating a live
      // sport_event. Identifiable later via market_mode "sport_side" +
      // sport_meta.provider_event_id; resolves at kickoff (effectiveEndDate).
      if (sideMarketMode && sportProviderEventId.trim() && sportStartTime) {
        sportMeta = {
          side_market: true,
          sport: selectedSport || "soccer",
          provider: sportProviderName || "thesportsdb",
          provider_event_id: sportProviderEventId.trim(),
          home_team: sportHomeTeam.trim() || undefined,
          away_team: sportAwayTeam.trim() || undefined,
          league: sportLeague || undefined,
          kickoff: sportStartTime.toISOString(),
          image:
            imagePreview && !imagePreview.startsWith("data:image/")
              ? imagePreview
              : undefined,
        };
      }

      let uploadedImageUrl: string | undefined;
      if (imageFile) {
        const mime = String(imageFile.type || "image/jpeg").toLowerCase();
        const ext =
          mime === "image/png"
            ? "png"
            : mime === "image/webp"
            ? "webp"
            : mime === "image/gif"
            ? "gif"
            : "jpg";
        const fileName = `${marketKeypair.publicKey.toBase58()}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("market-images")
          .upload(fileName, imageFile, {
            contentType: mime,
            upsert: true,
          });

        if (uploadErr) {
          throw new Error(`Image upload failed: ${uploadErr.message}`);
        }

        const { data: publicData } = supabase.storage
          .from("market-images")
          .getPublicUrl(fileName);

        if (!publicData?.publicUrl) {
          throw new Error("Image upload failed: missing public URL");
        }

        uploadedImageUrl = publicData.publicUrl;
      }

      if (imagePreview && imagePreview.startsWith("data:image/") && !uploadedImageUrl) {
        console.warn("[create] blocked base64 image_url");
        throw new Error("Image must be uploaded to storage. Base64 image URLs are not allowed.");
      }

      const persistedImageUrl =
        uploadedImageUrl ||
        (imagePreview && !imagePreview.startsWith("data:image/") ? imagePreview : undefined);

      let uploadedFeedVideoUrl: string | undefined;
      if (feedVideoFile) {
        const mime = String(feedVideoFile.type || "video/mp4").toLowerCase();
        const extFromMime =
          mime === "video/quicktime"
            ? "mov"
            : mime === "video/webm"
            ? "webm"
            : mime === "video/x-msvideo"
            ? "avi"
            : "mp4";
        const nameExt = feedVideoFile.name.split(".").pop()?.toLowerCase();
        const ext = nameExt && /^[a-z0-9]{2,5}$/.test(nameExt) ? nameExt : extFromMime;
        const fileName = `${marketKeypair.publicKey.toBase58()}.${ext}`;

        const { error: videoUploadErr } = await supabase.storage
          .from("market-feed-videos")
          .upload(fileName, feedVideoFile, {
            contentType: mime,
            upsert: true,
          });

        if (videoUploadErr) {
          throw new Error(`Video upload failed: ${videoUploadErr.message}`);
        }

        const { data: videoPublicData } = supabase.storage
          .from("market-feed-videos")
          .getPublicUrl(fileName);

        if (!videoPublicData?.publicUrl) {
          throw new Error("Video upload failed: missing public URL");
        }

        uploadedFeedVideoUrl = videoPublicData.publicUrl;
      }

      let uploadedFeedThumbnailUrl: string | undefined;
      if (uploadedFeedVideoUrl && feedVideoThumbnail) {
        try {
          const thumbName = `${marketKeypair.publicKey.toBase58()}.jpg`;
          const { error: thumbErr } = await supabase.storage
            .from("market-feed-thumbnails")
            .upload(thumbName, feedVideoThumbnail, {
              contentType: "image/jpeg",
              upsert: true,
            });
          if (!thumbErr) {
            const { data: thumbPublic } = supabase.storage
              .from("market-feed-thumbnails")
              .getPublicUrl(thumbName);
            if (thumbPublic?.publicUrl) {
              uploadedFeedThumbnailUrl = thumbPublic.publicUrl;
            }
          } else {
            console.warn("[create] feed thumbnail upload failed:", thumbErr.message);
          }
        } catch (thumbCatch) {
          console.warn("[create] feed thumbnail upload threw:", thumbCatch);
        }
      }

      // Fallback: if user did not upload a market image, use the video thumbnail
      // so existing card/home/search renderers still get an image.
      const effectiveImageUrl = persistedImageUrl || uploadedFeedThumbnailUrl;

      // Side markets: always prefix the displayed title with the match
      // context, e.g. "Brazil vs Morocco: Hakimi to score?". Only skip when the
      // question already STARTS WITH the same match label (avoid double-prefix).
      // Does not affect official admin matches or non-soccer markets.
      let effectiveQuestion = question.trim();
      if (sideMarketMode && sportHomeTeam.trim() && sportAwayTeam.trim()) {
        const matchLabel = `${sportHomeTeam.trim()} vs ${sportAwayTeam.trim()}`;
        effectiveQuestion = withMatchPrefix(matchLabel, effectiveQuestion);
      }

      await indexMarket({
        market_address: marketKeypair.publicKey.toBase58(),
        question: effectiveQuestion.slice(0, 200),
        description: fullDescription || undefined,
        category: category || "other",
        image_url: effectiveImageUrl,
        end_date: effectiveEndDate.toISOString(),
        start_time: dbStartTimeIso,
        end_time: dbEndTimeIso,
        creator: publicKey.toBase58(),
        feed_video_url: uploadedFeedVideoUrl,
        feed_thumbnail_url: uploadedFeedThumbnailUrl,

        market_type: onchainType,
        outcome_names: onchainNames,
        outcome_supplies: onchainSupplies,

        yes_supply: isBinary ? (onchainSupplies[0] ?? 0) : null,
        no_supply: isBinary ? (onchainSupplies[1] ?? 0) : null,

        total_volume: 0,

        // Sport fields (undefined for normal markets — ignored by indexMarket)
        // "sport"      → official admin match market (live sport_event linked)
        // "sport_side" → user soccer side market (no sport_event, ends at kickoff)
        market_mode: sportEventId
          ? "sport"
          : sideMarketMode && sportMeta
          ? "sport_side"
          : undefined,
        sport_event_id: sportEventId,
        sport_meta: sportMeta,
      } as any);

      const createdAddress = marketKeypair.publicKey.toBase58();
      setCreatedMarketAddress(createdAddress);
      setCreationStep("done");

      // Redirect to the new market. Works for normal, side, and official
      // markets (shared success path). The modal also shows a manual
      // "View market" link as a fallback if this push is interrupted.
      setTimeout(() => {
        router.push(`/trade/${createdAddress}`);
      }, 1200);
    } catch (e: any) {
      console.error("Create market error:", e);
      const errMsg = String(e?.message || "");

      if (errMsg.toLowerCase().includes("already been processed")) {
        setCreationError("Transaction already processed. Please refresh.");
      } else if (errMsg.toLowerCase().includes("user rejected")) {
        setCreationError("Transaction cancelled by user.");
      } else {
        setCreationError(errMsg || "Failed to create market");
      }

      setCreationStep("error");
    } finally {
      inFlightRef.current[key] = false;
      setLoading(false);
    }
  }

  // Build category options
  const categoryOptions = useMemo(() => {
    const options: { value: string; label: string; indent?: boolean; disabled?: boolean }[] = [];

    // Add placeholder option
    options.push({ value: "", label: "Choose a category...", disabled: true });

    for (const cat of CATEGORIES) {
      if (cat.id === "all") continue;

      if (cat.id === "sports") {
        options.push({ value: "sports", label: "🏆 Sports (General)" });
        for (const sport of SPORT_SUBCATEGORIES) {
          if (sport.id === "tennis") continue;
          options.push({
            value: sport.id,
            label: `    ${sport.label}`,
            indent: true,
          });
        }
      } else {
        options.push({ value: cat.id, label: cat.label });
      }
    }

    return options;
  }, []);

  const step2CanContinue =
    question.trim().length >= 10 &&
    !questionError &&
    !outcomesError &&
    (!sideMarketMode || sportProviderEventId.trim().length > 0);

  const stepTwo = (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-48 pt-8 sm:px-6 sm:pt-10">
      <div className="mb-8">
        <div className="mb-7 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            aria-label="Back to category"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1"><WizardProgress activeStep={2} /></div>
          <div className="h-10 w-10 shrink-0" aria-hidden="true" />
        </div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-pump-green">Step 2 of 4</p>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Ask a question</h1>
        <p className="mt-2 text-sm text-gray-400 sm:text-base">Add the details people will see and trade on.</p>
      </div>

      <div className="space-y-5">
        {(isMatchMode || sideMarketMode) && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-white">Fixture</h2>
                <p className="text-xs text-gray-500">{isMatchMode ? "Link an official match to auto-fill its details." : "Choose a match. Trading closes at kickoff."}</p>
              </div>
              {sportProviderEventId && <span className="flex items-center gap-1 text-xs font-bold text-pump-green"><CheckCircle className="h-3.5 w-3.5" /> Linked</span>}
            </div>
            {sportProviderEventId ? (
              <div className="rounded-xl border border-pump-green/30 bg-pump-green/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{sportHomeTeam} vs {sportAwayTeam}</p>
                    {sportLeague && <p className="text-xs text-gray-400">{sportLeague}</p>}
                    {sportStartTime && <p className="mt-1 text-xs text-gray-400">{sideMarketMode ? "Kickoff" : "Your time"}: {formatYourTime(sportStartTime)}</p>}
                  </div>
                  <div className="flex shrink-0 gap-3">
                    <button type="button" onClick={openMatchPicker} className="text-xs text-gray-300 hover:text-white">Change</button>
                    <button type="button" onClick={isMatchMode ? clearSelectedMatch : clearSideMatch} className="text-xs text-gray-400 hover:text-white">Clear</button>
                  </div>
                </div>
              </div>
            ) : (
              <button type="button" onClick={openMatchPicker} className="flex items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-4 py-2.5 text-sm font-bold text-white hover:border-pump-green/50">
                <Trophy className="h-4 w-4 text-pump-green" /> Pick a match{sideMarketMode ? " *" : ""}
              </button>
            )}
            {isMatchMode && (
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <input value={sportHomeTeam} onChange={(e) => setSportHomeTeam(e.target.value)} className="input-pump w-full" placeholder="Home team" maxLength={100} aria-label="Home team" />
                <input value={sportAwayTeam} onChange={(e) => setSportAwayTeam(e.target.value)} className="input-pump w-full" placeholder="Away team" maxLength={100} aria-label="Away team" />
              </div>
            )}
            {isMatchMode ? (
              <MatchPickerModal
                open={matchPickerOpen}
                onClose={() => setMatchPickerOpen(false)}
                onSelectMatch={selectMatch}
                sportType={sportType}
                onSportTypeChange={setSportType}
                excludeOfficial
              />
            ) : (
              <MatchPickerModal
                open={matchPickerOpen}
                onClose={() => setMatchPickerOpen(false)}
                onSelectMatch={selectSideMatch}
                sportType={sportType}
                onSportTypeChange={setSportType}
              />
            )}
          </section>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <label htmlFor="market-question" className="font-bold text-white">Question</label>
            <span className="text-xs text-gray-500">{question.length}/200</span>
          </div>
          <input
            id="market-question"
            value={question}
            onChange={(e) => handleQuestionChange(e.target.value)}
            maxLength={200}
            className={`input-pump w-full ${questionError ? "input-error" : ""}`}
            placeholder={isMatchMode ? "e.g. Alcaraz vs Zverev - Australian Open Final" : marketType === 0 ? "Will SOL reach $500 in 2025?" : "Which team wins the Super Bowl?"}
          />
          {questionError && <p className="mt-2 text-sm font-semibold text-pump-red">❌ {questionError}</p>}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-white">Market type</h2><span className="text-xs text-gray-500">Choose one</span></div>
          <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/25 p-1">
            {([0, 1] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setMarketType(type)}
                className={`rounded-lg px-3 py-2.5 text-sm font-bold transition ${marketType === type ? "bg-pump-green text-black" : "text-gray-400 hover:text-white"}`}
              >
                {type === 0 ? "Binary" : "Multi-choice"}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-white">{isMatchMode ? "Players / Teams" : "Outcomes"}</h3>
            {marketType === 1 && (
              <button type="button" onClick={addOutcome} disabled={outcomeInputs.length >= 10} className="flex items-center gap-1 rounded-lg bg-pump-green/15 px-2.5 py-1.5 text-xs font-bold text-pump-green disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500">
                <Plus className="h-3.5 w-3.5" /> Add outcome
              </button>
            )}
          </div>
          <div className={`mt-2.5 ${marketType === 0 ? "grid gap-2.5 min-[420px]:grid-cols-2" : "space-y-2"}`}>
            {outcomeInputs.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-7 shrink-0 text-center text-[11px] font-bold text-gray-500">{index + 1}</span>
                <input value={value} onChange={(e) => updateOutcomeAt(index, e.target.value)} className={`input-pump min-w-0 flex-1 ${outcomesError ? "input-error" : ""}`} placeholder={marketType === 0 ? (index === 0 ? "YES" : "NO") : `Option ${index + 1}`} aria-label={`Outcome ${index + 1}`} />
                {marketType === 1 && outcomeInputs.length > 2 && (
                  <button type="button" onClick={() => removeOutcome(index)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-400 hover:text-white" aria-label={`Remove outcome ${index + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {outcomesError && <p className="mt-2 text-sm font-semibold text-pump-red">❌ {outcomesError}</p>}
        </section>

        {isMatchMode && (
          <details className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
            <summary className="cursor-pointer text-sm font-bold text-white">Resolution details</summary>
            <div className="mt-4 space-y-3">
              <select value={resolutionSource} onChange={(e) => setResolutionSource(e.target.value)} className="input-pump w-full" aria-label="Resolution source">
                {RESOLUTION_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
              </select>
              <input type="url" value={proofLink} onChange={(e) => setProofLink(e.target.value)} className="input-pump w-full" placeholder="Proof link (recommended)" aria-label="Proof link" />
            </div>
          </details>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="mb-3">
            <h2 className="font-bold text-white">Media</h2>
            <p className="text-xs text-gray-500">Optional image or short video</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setActiveMediaPanel((panel) => panel === "image" ? null : "image")}
              className={`flex min-h-16 items-center gap-3 rounded-xl border px-3 text-left transition ${activeMediaPanel === "image" ? "border-pump-green/60 bg-pump-green/10" : "border-white/10 bg-black/20 hover:border-white/20"}`}
            >
              <Upload className={`h-5 w-5 shrink-0 ${imagePreview ? "text-pump-green" : "text-gray-400"}`} />
              <span><span className="block text-sm font-bold text-white">Image</span><span className="block text-[11px] text-gray-500">{imagePreview ? "Preview ready" : "PNG, JPG or GIF"}</span></span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMediaPanel((panel) => panel === "video" ? null : "video")}
              className={`flex min-h-16 items-center gap-3 rounded-xl border px-3 text-left transition ${activeMediaPanel === "video" ? "border-pump-green/60 bg-pump-green/10" : "border-white/10 bg-black/20 hover:border-white/20"}`}
            >
              <Upload className={`h-5 w-5 shrink-0 ${feedVideoPreview ? "text-pump-green" : "text-gray-400"}`} />
              <span><span className="block text-sm font-bold text-white">Video</span><span className="block text-[11px] text-gray-500">{feedVideoPreview ? "Preview ready" : "Add a feed clip"}</span></span>
            </button>
          </div>

          {(imagePreview || activeMediaPanel === "image") && (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
              {imagePreview ? (
                <div className="flex items-center gap-3">
                  <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-pump-dark">
                    <Image src={imagePreview} alt="Uploaded preview" fill className="object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{imageFile?.name || "Market image"}</p>
                    {imageFile && <p className="text-xs text-gray-500">{(imageFile.size / 1024).toFixed(0)} KB</p>}
                    <div className="mt-2 flex gap-3">
                      <label className="cursor-pointer text-xs font-semibold text-pump-green hover:underline">
                        Replace<input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                      </label>
                      <button type="button" onClick={removeImage} className="text-xs font-semibold text-gray-400 hover:text-white">Remove</button>
                    </div>
                  </div>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 px-4 py-5 text-sm font-semibold text-gray-300 transition hover:border-pump-green/60 hover:text-white">
                  <Upload className="h-4 w-4 text-pump-green" /> Choose an image
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              )}
              {imageError && <p className="mt-2 text-sm font-semibold text-pump-red">❌ {imageError}</p>}
            </div>
          )}

          <div className={activeMediaPanel === "video" || feedVideoPreview ? "mt-3 block" : "hidden"}>
            <FeedVideoUpload
              file={feedVideoFile}
              previewUrl={feedVideoPreview}
              thumbnailBlob={feedVideoThumbnail}
              onChange={(file, url, thumbnail) => {
                setFeedVideoFile(file);
                setFeedVideoPreview(url);
                setFeedVideoThumbnail(thumbnail);
              }}
            />
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-[6.25rem] z-30 px-4 md:bottom-14">
        <div className="mx-auto max-w-2xl">
          <button type="button" onClick={() => setCurrentStep(3)} disabled={!step2CanContinue} className={`w-full rounded-xl py-4 text-base font-black transition ${step2CanContinue ? "btn-pump glow-green" : "cursor-not-allowed bg-gray-800 text-gray-500"}`}>
            Next
          </button>
        </div>
      </div>
    </div>
  );

  const editableDateTime = isMatchMode && sportEndTime ? sportEndTime : resolutionDate;
  const updateEditableDateTime = (date: Date | null) => {
    if (!date) return;
    if (hasLinkedFixture) return;
    if (isMatchMode) {
      setSportEndTime(date);
      if (!resolutionDate || date > resolutionDate) {
        setResolutionDate(date);
      }
    } else {
      setResolutionDate(date);
    }
  };
  const displayDate = (date: Date) =>
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  const displayTime = (date: Date) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  const activeDraftDateTime = draftDateTime || editableDateTime;
  const selectedTimeMinutes =
    activeDraftDateTime.getHours() * 60 + activeDraftDateTime.getMinutes();
  const intervalTimeOptions = Array.from({ length: 96 }, (_, index) => index * 15);
  const timeOptions = intervalTimeOptions.includes(selectedTimeMinutes)
    ? intervalTimeOptions
    : [...intervalTimeOptions, selectedTimeMinutes].sort((a, b) => a - b);
  const closeDateTimePicker = () => {
    setDateTimePicker(null);
    setDraftDateTime(null);
  };
  const confirmDateTimePicker = () => {
    if (draftDateTime) updateEditableDateTime(draftDateTime);
    closeDateTimePicker();
  };

  const dateTimePickerModal = dateTimePicker ? (
    <div className="fixed inset-0 z-[100] flex bg-black/95 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={dateTimePicker === "date" ? "Select date" : "Select time"}>
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-black sm:h-[min(760px,calc(100vh-3rem))] sm:max-w-xl sm:rounded-3xl sm:border sm:border-white/10 sm:bg-[#0b0b0b] sm:shadow-2xl">
        <div className="flex h-16 shrink-0 items-center border-b border-white/10 px-4 sm:px-5">
          <button
            type="button"
            onClick={closeDateTimePicker}
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="flex-1 pr-11 text-center text-base font-black text-white">
            {dateTimePicker === "date" ? "Select date" : "Select time"}
          </h2>
        </div>

        {dateTimePicker === "date" ? (
          <div className="create-market-date-picker flex min-h-0 flex-1 items-start justify-center overflow-y-auto overscroll-contain px-4 py-6 sm:px-8">
            <DatePicker
              inline
              selected={activeDraftDateTime}
              minDate={new Date()}
              onChange={(date: Date | null) => {
                if (!date) return;
                const nextDate = new Date(date);
                nextDate.setHours(
                  activeDraftDateTime.getHours(),
                  activeDraftDateTime.getMinutes(),
                  activeDraftDateTime.getSeconds(),
                  activeDraftDateTime.getMilliseconds()
                );
                setDraftDateTime(nextDate);
              }}
              renderCustomHeader={({ date, decreaseMonth, increaseMonth, prevMonthButtonDisabled, nextMonthButtonDisabled }) => (
                <div className="mb-4 flex items-center justify-between px-1">
                  <button
                    type="button"
                    onClick={decreaseMonth}
                    disabled={prevMonthButtonDisabled}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 text-2xl text-white transition hover:border-pump-green/50 disabled:cursor-not-allowed disabled:text-gray-700"
                    aria-label="Previous month"
                  >
                    ‹
                  </button>
                  <span className="text-lg font-black text-white">
                    {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date)}
                  </span>
                  <button
                    type="button"
                    onClick={increaseMonth}
                    disabled={nextMonthButtonDisabled}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 text-2xl text-white transition hover:border-pump-green/50 disabled:cursor-not-allowed disabled:text-gray-700"
                    aria-label="Next month"
                  >
                    ›
                  </button>
                </div>
              )}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8">
            <p className="mb-4 text-center text-3xl font-black text-white">{displayTime(activeDraftDateTime)}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {timeOptions.map((minutes) => {
                const optionDate = new Date(activeDraftDateTime);
                optionDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
                const selected = minutes === selectedTimeMinutes;
                return (
                  <button
                    key={minutes}
                    ref={selected ? selectedTimeOptionRef : undefined}
                    type="button"
                    onClick={() => setDraftDateTime(optionDate)}
                    className={`min-h-14 rounded-xl border px-4 text-base font-bold transition ${selected ? "border-pump-green bg-pump-green text-black" : "border-white/10 bg-white/[0.035] text-gray-200 hover:border-white/25"}`}
                  >
                    {displayTime(optionDate)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-white/10 bg-black/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <button type="button" onClick={closeDateTimePicker} className="rounded-xl border border-white/15 py-3.5 font-bold text-gray-200 transition hover:bg-white/5">
            Cancel
          </button>
          <button type="button" onClick={confirmDateTimePicker} className="btn-pump rounded-xl py-3.5 font-black">
            Done
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const stepThree = (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-48 pt-8 sm:px-6 sm:pt-10">
      <div className="mb-8">
        <div className="mb-7 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            aria-label="Back to market"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1"><WizardProgress activeStep={3} /></div>
          <div className="h-10 w-10 shrink-0" aria-hidden="true" />
        </div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-pump-green">Step 3 of 4</p>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">When will it end?</h1>
        <p className="mt-2 text-sm text-gray-400 sm:text-base">Choose when trading closes.</p>
      </div>

      {sideMarketMode ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Calendar className="h-4 w-4 text-pump-green" /> Match kickoff
            </div>
            <span className="rounded-full bg-pump-green/10 px-2.5 py-1 text-[11px] font-bold text-pump-green">Automatic</span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-gray-500">Date</p>
              <p className="mt-1 font-bold text-white">{displayDate(resolutionDate)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-gray-500">Time</p>
              <p className="mt-1 font-bold text-white">{displayTime(resolutionDate)}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-400">Trading closes automatically at kickoff.</p>
        </section>
      ) : isMatchMode && hasLinkedFixture ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Calendar className="h-4 w-4 text-pump-green" /> Trading closes
            </div>
            <span className="rounded-full bg-pump-green/10 px-2.5 py-1 text-[11px] font-bold text-pump-green">Automatic from fixture</span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-gray-500">Date</p>
              <p className="mt-1 font-bold text-white">{displayDate(resolutionDate)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-gray-500">Time</p>
              <p className="mt-1 font-bold text-white">{displayTime(resolutionDate)}</p>
            </div>
          </div>
          {sportStartTime && (
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-sm">
              <span className="text-gray-500">Kickoff</span>
              <span className="font-semibold text-gray-200">{displayDate(sportStartTime)} · {displayTime(sportStartTime)}</span>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
            <Calendar className="h-4 w-4 text-pump-green" /> End date &amp; time
          </div>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-500">End date</label>
              <button
                type="button"
                onClick={() => {
                  setDraftDateTime(new Date(editableDateTime));
                  setDateTimePicker("date");
                }}
                className="input-pump flex w-full items-center justify-between text-left font-semibold text-white"
              >
                {displayDate(editableDateTime)}
                <Calendar className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-500">Time</label>
              <button
                type="button"
                onClick={() => {
                  setDraftDateTime(new Date(editableDateTime));
                  setDateTimePicker("time");
                }}
                className="input-pump flex w-full items-center justify-between text-left font-semibold text-white"
              >
                {displayTime(editableDateTime)}
                <span className="text-xs font-bold text-pump-green">Change</span>
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-400">Trading closes at this time.</p>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-[6.25rem] z-30 px-4 md:bottom-14">
        <div className="mx-auto max-w-2xl">
          <button type="button" onClick={() => setCurrentStep(4)} className="btn-pump glow-green w-full rounded-xl py-4 text-base font-black transition">
            Next
          </button>
        </div>
      </div>
      {dateTimePickerModal}
    </div>
  );

  const reviewCategoryLabel =
    category === "soccer"
      ? "Football"
      : SPORT_SUBCATEGORIES.find((sport) => sport.id === category)?.label ||
        CATEGORIES.find((item) => item.id === category)?.label ||
        "Uncategorized";
  const reviewResolutionSource =
    RESOLUTION_SOURCES.find((source) => source.value === resolutionSource)?.label || resolutionSource;
  const hasReviewMedia = Boolean(imagePreview || feedVideoFile || feedVideoPreview);

  const stepFour = (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-64 pt-8 sm:px-6 sm:pt-10">
      <div className="mb-8">
        <div className="mb-7 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            aria-label="Back to date and time"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1"><WizardProgress activeStep={4} /></div>
          <div className="h-10 w-10 shrink-0" aria-hidden="true" />
        </div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-pump-green">Step 4 of 4</p>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Review &amp; launch</h1>
        <p className="mt-2 text-sm text-gray-400 sm:text-base">Make sure everything looks right.</p>
      </div>

      <div className="space-y-4">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
          {imagePreview && (
            <div className="relative h-36 w-full bg-pump-dark sm:h-44">
              <Image src={imagePreview} alt="Market preview" fill className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            </div>
          )}
          <div className="p-5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
              <span className="rounded-full bg-pump-green/10 px-2.5 py-1 text-pump-green">{reviewCategoryLabel}</span>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-gray-400">{marketType === 0 ? "Binary" : "Multi-choice"}</span>
            </div>
            <h2 className="mt-4 text-xl font-black leading-snug text-white sm:text-2xl">{question}</h2>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-sm">
              <span className="text-gray-500">Closes</span>
              <span className="text-right font-bold text-white">{displayDate(resolutionDate)} · {displayTime(resolutionDate)}</span>
            </div>

            {sportProviderEventId && (
              <div className="mt-4 rounded-xl border border-pump-green/20 bg-pump-green/[0.06] p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-pump-green">
                  <CheckCircle className="h-3.5 w-3.5" /> Linked fixture
                </div>
                <p className="mt-2 text-sm font-bold text-white">{sportHomeTeam} vs {sportAwayTeam}</p>
                {sportLeague && <p className="mt-0.5 text-xs text-gray-400">{sportLeague}</p>}
                {sportStartTime && <p className="mt-1 text-xs text-gray-500">Kickoff · {displayDate(sportStartTime)} · {displayTime(sportStartTime)}</p>}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold text-white">Outcomes</h2>
            <button type="button" onClick={() => setCurrentStep(2)} className="min-h-10 px-2 text-sm font-bold text-pump-green hover:underline">Edit</button>
          </div>
          <div className={`mt-3 grid gap-2 ${outcomes.length === 2 ? "grid-cols-2" : "grid-cols-1 min-[420px]:grid-cols-2"}`}>
            {outcomes.map((outcome, index) => (
              <div key={`${outcome}-${index}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-center text-sm font-bold text-white">
                {outcome}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-white">Closes</h2>
              <p className="mt-1 text-sm font-semibold text-gray-300">{displayDate(resolutionDate)} · {displayTime(resolutionDate)}</p>
              {(sideMarketMode || hasLinkedFixture) && <p className="mt-1 text-xs text-pump-green">Automatic from fixture</p>}
            </div>
            <button type="button" onClick={() => setCurrentStep(3)} className="min-h-10 px-2 text-sm font-bold text-pump-green hover:underline">Edit</button>
          </div>
        </section>

        {hasReviewMedia && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-white">Media</h2>
              <button type="button" onClick={() => setCurrentStep(2)} className="min-h-10 px-2 text-sm font-bold text-pump-green hover:underline">Edit</button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              {imagePreview && (
                <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-pump-dark">
                  <Image src={imagePreview} alt="Attached market image" fill className="object-cover" />
                </div>
              )}
              {(feedVideoFile || feedVideoPreview) && (
                <div className="flex min-h-20 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4">
                  <Upload className="h-5 w-5 shrink-0 text-pump-green" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">Feed video attached</p>
                    {feedVideoFile?.name && <p className="truncate text-xs text-gray-500">{feedVideoFile.name}</p>}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <label htmlFor="review-description" className="font-bold text-white">Resolution details</label>
              <p className="mt-0.5 text-xs text-gray-500">Explain how this market should be resolved.</p>
            </div>
            <span className="shrink-0 text-xs text-gray-500">{description.length}/500</span>
          </div>
          <textarea
            id="review-description"
            value={description}
            onChange={(event) => handleDescriptionChange(event.target.value)}
            maxLength={5000}
            rows={3}
            className={`input-pump w-full resize-none ${descriptionError ? "input-error" : ""}`}
            placeholder="Add resolution conditions or useful context..."
          />
          {descriptionError && <p className="mt-2 text-sm font-semibold text-pump-red">❌ {descriptionError}</p>}

          {isMatchMode && (
            <div className="mt-4 space-y-2 border-t border-white/10 pt-4 text-sm">
              <div className="flex items-start justify-between gap-4">
                <span className="text-gray-500">Source</span>
                <span className="text-right font-semibold text-gray-200">{reviewResolutionSource}</span>
              </div>
              {proofLink.trim() && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-gray-500">Proof</span>
                  <span className="max-w-[70%] truncate text-right font-semibold text-gray-200">{proofLink.trim()}</span>
                </div>
              )}
              <button type="button" onClick={() => setCurrentStep(2)} className="min-h-10 text-sm font-bold text-pump-green hover:underline">Edit sports resolution</button>
            </div>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-[6.25rem] z-30 px-4 md:bottom-14">
        <div className="mx-auto max-w-2xl rounded-2xl bg-black/90 pt-3 backdrop-blur-xl">
          {!connected && !connecting && privy.configured && !isPlayMode ? (
            <button type="button" onClick={() => privy.loginWithGoogle()} className="btn-pump glow-green w-full rounded-xl py-4 text-base font-black transition">
              Continue with Google
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreateMarket}
              disabled={!canSubmit || loading || isPlayMode}
              aria-busy={loading}
              className={`w-full rounded-xl py-4 text-base font-black transition ${canSubmit && !loading && !isPlayMode ? "btn-pump glow-green" : "cursor-not-allowed bg-gray-800 text-gray-500"}`}
            >
              {loading ? "Processing..." : "Create market"}
            </button>
          )}
          {isPlayMode && <p className="mt-2 text-center text-xs text-gray-400">Market creation is available in Real mode.</p>}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <CreationModal step={creationStep} error={creationError} onClose={closeCreationModal} marketAddress={createdMarketAddress} />
      <div className={currentStep === 1 ? "block" : "hidden"}>
        <CategoryStep
          category={category}
          onSelect={(nextCategory) => {
            setCategory(nextCategory);
            const mappedSport = pickerSportFromCategory(nextCategory);
            if (mappedSport) setSportType(mappedSport);
          }}
          onNext={() => setCurrentStep(2)}
          onClose={() => router.back()}
        />
      </div>
      <div className={currentStep === 2 ? "block" : "hidden"}>{stepTwo}</div>
      {currentStep === 3 && stepThree}
      {currentStep === 4 && stepFour}
    </>
  );
}
