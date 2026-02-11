"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { SystemProgram, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useRouter } from "next/navigation";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Calendar, Upload, X, Plus, Trash2, Info, AlertTriangle, CheckCircle, Loader2, Search, Trophy } from "lucide-react";
import Image from "next/image";

import { validateMarketQuestion, validateMarketDescription } from "@/utils/bannedWords";
import { CATEGORIES, SPORT_SUBCATEGORIES, isSportSubcategory } from "@/components/CategoryFilters";
import type { CategoryId, SportSubcategoryId } from "@/components/CategoryFilters";
import SocialLinksForm, { SocialLinks } from "@/components/SocialLinksForm";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";

import { useProgram } from "@/hooks/useProgram";
import { indexMarket } from "@/lib/markets";
import { createSportEventServer } from "@/lib/sportEvents";
import { sendSignedTx } from "@/lib/solanaSend";

// Combined category type for create page
type CreateCategoryId = CategoryId | SportSubcategoryId | "";

// Creation steps
type CreationStep = "idle" | "signing" | "confirming" | "indexing" | "done" | "error";

// Resolution sources for sports
const RESOLUTION_SOURCES = [
  { value: "official_league", label: "Official league website" },
  { value: "atp_wta", label: "ATP/WTA official scoreboard" },
  { value: "fifa_uefa", label: "FIFA / UEFA official" },
  { value: "espn_flashscore", label: "ESPN / Flashscore" },
  { value: "other", label: "Other (specify in notes)" },
] as const;

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

// ---------- Match Picker Modal ----------
function MatchPickerModal({
  open,
  onClose,
  onSelectMatch,
  sportType,
  onSportTypeChange,
}: {
  open: boolean;
  onClose: () => void;
  onSelectMatch: (m: any) => void;
  sportType: string;
  onSportTypeChange: (s: string) => void;
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
        body: JSON.stringify({ sport: sportType }),
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
      const d = new Date(m.start_time);
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
              <option value="tennis">Tennis</option>
              <option value="mma">MMA</option>
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
                    const d = new Date(m.start_time);
                    const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
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
                            {timeStr}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400 truncate">{m.league}</span>
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
}: {
  step: CreationStep;
  error: string | null;
  onClose: () => void;
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
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const program = useProgram();

  const [loading, setLoading] = useState(false);
  const [creationStep, setCreationStep] = useState<CreationStep>("idle");
  const [creationError, setCreationError] = useState<string | null>(null);

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

  const [resolutionDate, setResolutionDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  });

  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  // Sports-specific fields
  const [resolutionSource, setResolutionSource] = useState<string>("official_league");
  const [proofLink, setProofLink] = useState<string>("");

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

  // Match picker modal
  const [matchPickerOpen, setMatchPickerOpen] = useState(false);

  // Sports mode: "match" (default for sport subcategories) or "general" (Sports General only)
  const [sportsMode, setSportsMode] = useState<"match" | "general">("match");

  // Check if current category is a sport
  const isSportsMarket = useMemo(() => {
    return category === "sports" || (category !== "" && isSportSubcategory(category));
  }, [category]);

  // Is this specifically the "Sports (General)" top-level category?
  const isSportsGeneral = category === "sports";

  // Should we show match-specific fields? (match picker, sport type, teams, match end time)
  const isMatchMode = isSportsMarket && !(isSportsGeneral && sportsMode === "general");

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
    resolutionDate > new Date();

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

    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview("");
    setImageError("");
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
    setSportType(m.sport || sportType);
    setSportHomeTeam(m.home_team);
    setSportAwayTeam(m.away_team);
    setSportLeague(m.league || "");
    setSportProviderEventId(m.provider_event_id || "");
    setSportProviderName(m.provider || "");
    setSportRaw(m.raw ?? null);

    // Track match start_time separately for sport_meta
    if (m.start_time) setSportStartTime(new Date(m.start_time));

    // resolutionDate = when market/trading ends = end_time (already T-2 adjusted)
    // NOT start_time — that was the bug causing premature "ended" state
    if (m.end_time) {
      const endDate = new Date(m.end_time);
      setResolutionDate(endDate);
      setSportEndTime(endDate);
    } else if (m.start_time) {
      // Fallback: no end_time → estimate from start + sport duration - T2
      const SPORT_DURATIONS: Record<string, number> = {
        soccer: 2 * 3600_000 + 15 * 60_000,
        basketball: 2 * 3600_000 + 30 * 60_000,
        tennis: 3 * 3600_000,
        american_football: 3 * 3600_000 + 30 * 60_000,
        mma: 2 * 3600_000,
      };
      const dur = SPORT_DURATIONS[m.sport] || SPORT_DURATIONS.soccer;
      const T2 = 2 * 60_000;
      const estimated = new Date(new Date(m.start_time).getTime() + dur - T2);
      setResolutionDate(estimated);
      setSportEndTime(estimated);
    }

    setQuestion(`${m.home_team} vs ${m.away_team}${m.league ? ` - ${m.league}` : ""}`);
    if (marketType === 0) {
      setOutcomeInputs([m.home_team, m.away_team]);
    }
  }

  function clearSelectedMatch() {
    setSportProviderEventId("");
    setSportProviderName("");
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

  async function handleCreateMarket() {
    if (!canSubmit || !publicKey || !program) return;
    if (!signTransaction) {
      alert("Wallet cannot sign transactions (signTransaction missing).");
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

      // For sport markets: ensure resolution time = sport end (T-2), not match start
      // Safety: if resolutionDate somehow ended up <= sportStartTime, recompute
      let effectiveEndDate = resolutionDate;
      if (isMatchMode && sportStartTime && resolutionDate.getTime() <= sportStartTime.getTime()) {
        const SPORT_DURATIONS: Record<string, number> = {
          soccer: 2 * 3600_000 + 15 * 60_000,
          basketball: 2 * 3600_000 + 30 * 60_000,
          tennis: 3 * 3600_000,
          american_football: 3 * 3600_000 + 30 * 60_000,
          mma: 2 * 3600_000,
        };
        const dur = SPORT_DURATIONS[sportType] || SPORT_DURATIONS.soccer;
        const T2 = 2 * 60_000;
        effectiveEndDate = new Date(sportStartTime.getTime() + dur - T2);
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
      if (isMatchMode && sportHomeTeam.trim() && sportAwayTeam.trim()) {
        // Use actual match start_time (not resolutionDate which is end_time/T-2)
        const matchStart = sportStartTime || resolutionDate;
        const matchEnd = sportEndTime || resolutionDate;

        const evt = await createSportEventServer({
          provider: sportProviderEventId ? (sportProviderName || "thesportsdb") : "manual",
          provider_event_id: sportProviderEventId || `manual_${marketKeypair.publicKey.toBase58()}`,
          sport: sportType,
          home_team: sportHomeTeam.trim(),
          away_team: sportAwayTeam.trim(),
          start_time: matchStart.toISOString(),
          end_time: matchEnd.toISOString(),
          league: sportLeague || undefined,
          raw: sportRaw ?? undefined,
        });
        sportEventId = evt.id;
        sportMeta = {
          sport: sportType,
          provider: sportProviderEventId ? (sportProviderName || "thesportsdb") : "manual",
          provider_event_id: sportProviderEventId || undefined,
          home_team: sportHomeTeam.trim(),
          away_team: sportAwayTeam.trim(),
          start_time: matchStart.toISOString(),
          end_time: matchEnd.toISOString(),
          raw: sportRaw ?? undefined,
        };
      }

      await indexMarket({
        market_address: marketKeypair.publicKey.toBase58(),
        question: question.slice(0, 200),
        description: fullDescription || undefined,
        category: category || "other",
        image_url: imagePreview || undefined,
        end_date: effectiveEndDate.toISOString(),
        creator: publicKey.toBase58(),
        social_links: socialLinks,

        market_type: onchainType,
        outcome_names: onchainNames,
        outcome_supplies: onchainSupplies,

        yes_supply: isBinary ? (onchainSupplies[0] ?? 0) : null,
        no_supply: isBinary ? (onchainSupplies[1] ?? 0) : null,

        total_volume: 0,

        // Sport fields (undefined for normal markets — ignored by indexMarket)
        market_mode: sportEventId ? "sport" : undefined,
        sport_event_id: sportEventId,
        sport_meta: sportMeta,
      } as any);

      setCreationStep("done");

      // Redirect after short delay
      setTimeout(() => {
        router.push(`/trade/${marketKeypair.publicKey.toBase58()}`);
      }, 1500);
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
      if (cat.id === "all" || cat.id === "trending") continue;

      if (cat.id === "sports") {
        options.push({ value: "sports", label: "🏆 Sports (General)" });
        for (const sport of SPORT_SUBCATEGORIES) {
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

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
      {/* Creation Progress Modal */}
      <CreationModal step={creationStep} error={creationError} onClose={closeCreationModal} />

      <div className="mb-7 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Create Market</h1>
        <p className="text-gray-400">Launch a prediction market. Keep it clean - Make it Fun.</p>
      </div>

      <div className="card-pump">
        {/* Category - First so sports mode activates early */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">Category *</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CreateCategoryId)}
            className={`input-pump w-full ${!category ? "text-gray-500" : ""}`}
          >
            {categoryOptions.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
          {isSportSubcategory(category as string) && (
            <p className="text-xs text-gray-500 mt-2">
              This market will appear under Sports → {SPORT_SUBCATEGORIES.find((s) => s.id === category)?.label}
            </p>
          )}
        </div>

        {/* Sports mode toggle (only for "Sports (General)" top-level) */}
        {isSportsGeneral && (
          <div className="mb-6">
            <label className="block text-white font-semibold mb-2">Market Type</label>
            <div className="grid grid-cols-2 gap-3">
              <TypeCard
                active={sportsMode === "match"}
                onClick={() => setSportsMode("match")}
                title="Match"
                desc="Tied to a specific match with auto-lock."
              />
              <TypeCard
                active={sportsMode === "general"}
                onClick={() => setSportsMode("general")}
                title="General"
                desc="General sports question (e.g. medals, awards)."
              />
            </div>
          </div>
        )}

        {/* Sports Info Box */}
        {isSportsMarket && (
          <div className="mb-6">
            <InfoBox>
              {isMatchMode ? (
                <>
                  <p className="font-semibold mb-1">Sports Match Market</p>
                  <p>Live trading enabled. Trading auto-locks 2 minutes before end time. After the match ends, you have 24h to propose the outcome.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold mb-1">Sports Question</p>
                  <p>General sports prediction market. Resolution works like a normal market — propose the outcome before the end date.</p>
                </>
              )}
            </InfoBox>
          </div>
        )}

        {/* Pick a match — opens modal */}
        {isMatchMode && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-white font-semibold">
                Select a match (optional)
              </label>
              {sportProviderEventId && (
                <span className="text-xs font-medium text-pump-green flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> Linked
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Pick from upcoming matches to auto-fill teams, times, and enable live score tracking.
            </p>

            {/* Selected match banner */}
            {sportProviderEventId ? (
              <div className="flex items-center justify-between p-3 mb-3 rounded-lg bg-pump-green/10 border border-pump-green/30">
                <span className="text-sm text-white font-medium">
                  {sportHomeTeam} vs {sportAwayTeam}
                  {sportLeague ? <span className="text-gray-400 ml-2">({sportLeague})</span> : null}
                </span>
                <div className="flex items-center gap-2 ml-3">
                  <button
                    type="button"
                    onClick={() => setMatchPickerOpen(true)}
                    className="text-xs text-gray-400 hover:text-white underline"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={clearSelectedMatch}
                    className="text-xs text-gray-400 hover:text-white underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setMatchPickerOpen(true)}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 bg-white/10 text-white border border-white/20 hover:bg-white/15 hover:border-white/30"
              >
                <Trophy className="w-4 h-4 text-pump-green" />
                Pick a match
              </button>
            )}

            <MatchPickerModal
              open={matchPickerOpen}
              onClose={() => setMatchPickerOpen(false)}
              onSelectMatch={selectMatch}
              sportType={sportType}
              onSportTypeChange={setSportType}
            />
          </div>
        )}

        {/* Teams / Players (auto-filled by fixture selection, or manual entry) */}
        {isMatchMode && (
          <div className="mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-white font-semibold mb-2">
                  {sportType === "mma" || sportType === "tennis" ? "Player A *" : "Home Team *"}
                </label>
                <input
                  type="text"
                  value={sportHomeTeam}
                  onChange={(e) => setSportHomeTeam(e.target.value)}
                  className="input-pump w-full"
                  placeholder={sportType === "mma" || sportType === "tennis" ? "e.g. Alcaraz" : "e.g. Real Madrid"}
                  maxLength={100}
                />
              </div>
              <div>
                <label className="block text-white font-semibold mb-2">
                  {sportType === "mma" || sportType === "tennis" ? "Player B *" : "Away Team *"}
                </label>
                <input
                  type="text"
                  value={sportAwayTeam}
                  onChange={(e) => setSportAwayTeam(e.target.value)}
                  className="input-pump w-full"
                  placeholder={sportType === "mma" || sportType === "tennis" ? "e.g. Zverev" : "e.g. Barcelona"}
                  maxLength={100}
                />
              </div>
            </div>
          </div>
        )}

        {/* Question / Match */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            {isMatchMode ? "Match *" : "Question *"}{" "}
            <span className="text-gray-500 font-normal text-sm ml-2">({question.length}/200)</span>
          </label>
          <input
            type="text"
            value={question}
            onChange={(e) => handleQuestionChange(e.target.value)}
            maxLength={200}
            className={`input-pump w-full ${questionError ? "input-error" : ""}`}
            placeholder={
              isMatchMode
                ? "e.g. Alcaraz vs Zverev - Australian Open Final"
                : marketType === 0
                ? "Will SOL reach $500 in 2025?"
                : "Which team wins the Super Bowl?"
            }
          />
          {questionError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {questionError}</p>}
        </div>

        {/* Description / Notes */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            {isMatchMode ? "Notes (optional)" : "Description (optional)"}{" "}
            <span className="text-gray-500 font-normal text-sm ml-2">({description.length}/500)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            maxLength={500}
            rows={3}
            className={`input-pump w-full ${descriptionError ? "input-error" : ""}`}
            placeholder={isMatchMode ? "Any additional context about the match..." : "Describe the resolution conditions..."}
          />
          {descriptionError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {descriptionError}</p>}
        </div>

        {/* Sports-specific: Resolution Source */}
        {isMatchMode && (
          <div className="mb-6">
            <label className="block text-white font-semibold mb-2">Resolution Source *</label>
            <select
              value={resolutionSource}
              onChange={(e) => setResolutionSource(e.target.value)}
              className="input-pump w-full"
            >
              {RESOLUTION_SOURCES.map((src) => (
                <option key={src.value} value={src.value}>
                  {src.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">Where will you check the official result?</p>
          </div>
        )}

        {/* Sports-specific: Proof Link */}
        {isMatchMode && (
          <div className="mb-6">
            <label className="block text-white font-semibold mb-2">Proof Link (recommended)</label>
            <input
              type="url"
              value={proofLink}
              onChange={(e) => setProofLink(e.target.value)}
              className="input-pump w-full"
              placeholder="https://www.atptour.com/en/scores/..."
            />
            <p className="text-xs text-gray-500 mt-2">Link to the official match page (helps with disputes)</p>
          </div>
        )}

        {/* Market type */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">Market type *</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TypeCard
              active={marketType === 0}
              onClick={() => setMarketType(0)}
              title="Binary"
              desc={isMatchMode ? "2 players/teams. Head-to-head." : "Exactly 2 outcomes (YES/NO)."}
            />
            <TypeCard
              active={marketType === 1}
              onClick={() => setMarketType(1)}
              title="Multi-choice"
              desc={isMatchMode ? "Tournament winner, podium, etc." : "2–10 outcomes."}
            />
          </div>
        </div>

        {/* Outcomes */}
        <div className="mb-6">
          <div className="flex items-end justify-between gap-3 mb-2">
            <label className="block text-white font-semibold">
              {isMatchMode ? "Players / Teams *" : "Outcomes *"}{" "}
              <span className="text-gray-500 font-normal text-sm ml-2">({marketType === 0 ? "must be 2" : "2 to 10"})</span>
            </label>

            {marketType === 1 && (
              <button
                type="button"
                onClick={addOutcome}
                disabled={outcomeInputs.length >= 10}
                className={[
                  "px-3 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2",
                  outcomeInputs.length >= 10
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-pump-green text-black hover:opacity-90",
                ].join(" ")}
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            )}
          </div>

          <div className="space-y-2">
            {outcomeInputs.map((val, idx) => {
              const showRemove = marketType === 1 && outcomeInputs.length > 2;

              return (
                <div key={idx} className="flex items-center gap-2">
                  <div className="w-12 text-xs text-gray-500 font-mono flex-shrink-0">
                    {marketType === 0 ? (isMatchMode ? (idx === 0 ? "P1" : "P2") : idx === 0 ? "YES" : "NO") : `#${idx + 1}`}
                  </div>

                  <input
                    value={val}
                    onChange={(e) => updateOutcomeAt(idx, e.target.value)}
                    className={`input-pump w-full ${outcomesError ? "input-error" : ""}`}
                    placeholder={
                      isMatchMode
                        ? idx === 0
                          ? "e.g. Alcaraz"
                          : "e.g. Zverev"
                        : marketType === 0
                        ? idx === 0
                          ? "YES"
                          : "NO"
                        : `Option ${idx + 1}`
                    }
                  />

                  {showRemove ? (
                    <button
                      type="button"
                      onClick={() => removeOutcome(idx)}
                      className="w-10 h-10 rounded-lg border border-white/10 bg-black/30 hover:border-white/20 transition flex items-center justify-center"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4 text-gray-300" />
                    </button>
                  ) : (
                    <div className="w-10 h-10" />
                  )}
                </div>
              );
            })}
          </div>

          {outcomesError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {outcomesError}</p>}
        </div>

        {/* Image */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">Market Image (Optional)</label>

          {!imagePreview ? (
            <>
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-pump-green transition-colors bg-pump-dark/50">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 text-gray-500 mb-2" />
                  <p className="text-sm text-gray-400 mb-1">
                    <span className="font-semibold text-pump-green">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">PNG, JPG, GIF up to 5MB</p>
                </div>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>

              {imageError && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {imageError}</p>}

              {category && (
                <div className="mt-4">
                  <p className="text-sm text-gray-400 mb-2">Default placeholder for {category}:</p>
                  <div className="relative w-full h-48 rounded-lg overflow-hidden">
                    <CategoryImagePlaceholder category={category} className="w-full h-full" />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mt-4 relative">
                <div className="relative w-full h-48 rounded-lg overflow-hidden bg-pump-dark border border-gray-700">
                  <Image src={imagePreview} alt="Uploaded preview" fill className="object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-pump-dark/80 to-transparent" />
                </div>

                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-2 right-2 w-8 h-8 bg-pump-red hover:bg-red-600 rounded-full flex items-center justify-center transition-colors shadow-lg"
                  title="Remove image"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {imageFile && (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-gray-400 truncate flex-1">{imageFile.name}</span>
                  <span className="text-gray-500 ml-2">{(imageFile.size / 1024).toFixed(0)} KB</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* End Date / Match End Time */}
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            {isMatchMode ? "Match End Time *" : "End Date & Time *"}
          </label>
          <div className="relative">
            <DatePicker
              selected={isMatchMode && sportEndTime ? sportEndTime : resolutionDate}
              onChange={(date: Date | null) => {
                if (!date) return;
                if (isMatchMode) {
                  setSportEndTime(date);
                  // Also push resolution date forward if needed
                  if (!resolutionDate || date > resolutionDate) {
                    setResolutionDate(date);
                  }
                } else {
                  setResolutionDate(date);
                }
              }}
              showTimeSelect
              timeFormat="HH:mm"
              timeIntervals={15}
              dateFormat="MMMM d, yyyy h:mm aa"
              minDate={new Date()}
              className="input-pump w-full pl-10"
              placeholderText={isMatchMode ? "Select match end time" : "Select end date and time"}
            />
            <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none" />
          </div>
          {isMatchMode && (
            <p className="text-xs text-gray-500 mt-2">Live trading enabled. Trading auto-locks 2 minutes before end time.</p>
          )}
        </div>

        {/* Social */}
        <div className="mb-6 pb-6 border-b border-gray-800">
          <SocialLinksForm value={socialLinks} onChange={setSocialLinks} />
        </div>

        {/* Cancellation Policy Warning (Match only) */}
        {isMatchMode && (
          <div className="mb-6">
            <WarningBox>
              <p className="font-semibold mb-2">Cancellation Policy</p>
              <ul className="list-disc list-inside space-y-1 text-yellow-200/80">
                <li>
                  If the match is postponed, suspended, or abandoned and no official result is available within 24h, the
                  market may be cancelled and all bets refunded.
                </li>
                <li>If you fail to propose an outcome within 24h after the match, admin may cancel the market.</li>
              </ul>
            </WarningBox>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleCreateMarket}
          disabled={!canSubmit || loading}
          aria-busy={loading}
          className={`w-full py-4 rounded-lg font-bold text-lg transition ${
            canSubmit && !loading ? "btn-pump glow-green" : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
        >
          {loading ? "Processing..." : isSportsMarket ? "Create Sports Market 🏆" : "Launch Market 🚀"}
        </button>
      </div>
    </div>
  );
}