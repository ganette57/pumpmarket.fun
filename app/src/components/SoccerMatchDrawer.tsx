"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GoalEntry = { player: string; minute: string; cutout?: string };
type PlayerEntry = { name: string; position: string };
type StatEntry = { label: string; home: string; away: string };
type TimelineEntry = {
  type: string;
  detail: string;
  player: string;
  team: string;
  isHome: boolean;
  minute: number;
  cutout?: string;
  assist?: string;
};

type LineupData = {
  starters: PlayerEntry[];
  substitutes: PlayerEntry[];
};

type EventDetails = {
  available: boolean;
  home_team: string;
  away_team: string;
  home_badge: string | null;
  away_badge: string | null;
  home_goals: GoalEntry[];
  away_goals: GoalEntry[];
  home_lineup: LineupData;
  away_lineup: LineupData;
  statistics: StatEntry[];
  timeline: TimelineEntry[];
  home_formation: string | null;
  away_formation: string | null;
};

interface SoccerMatchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  isMobile?: boolean;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
      {children}
    </h4>
  );
}

function StatBar({ stat }: { stat: StatEntry }) {
  const hNum = parseFloat(stat.home) || 0;
  const aNum = parseFloat(stat.away) || 0;
  const total = hNum + aNum || 1;
  const hPct = (hNum / total) * 100;
  const aPct = (aNum / total) * 100;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-xs text-gray-200 mb-1">
        <span className="font-semibold tabular-nums w-8 text-left">{stat.home}</span>
        <span className="text-gray-500 text-[11px] uppercase tracking-wide">{stat.label}</span>
        <span className="font-semibold tabular-nums w-8 text-right">{stat.away}</span>
      </div>
      <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-white/5">
        <div
          className="rounded-full transition-all duration-500"
          style={{
            width: `${hPct}%`,
            background: hNum >= aNum
              ? "linear-gradient(90deg, #7CFF6B, #4ADE80)"
              : "rgba(255,255,255,0.2)",
          }}
        />
        <div
          className="rounded-full transition-all duration-500"
          style={{
            width: `${aPct}%`,
            background: aNum >= hNum
              ? "linear-gradient(270deg, #7CFF6B, #4ADE80)"
              : "rgba(255,255,255,0.2)",
          }}
        />
      </div>
    </div>
  );
}

function LineupSection({
  lineup,
  teamName,
  formation,
  badge,
}: {
  lineup: LineupData;
  teamName: string;
  formation: string | null;
  badge: string | null;
}) {
  if (lineup.starters.length === 0 && lineup.substitutes.length === 0) {
    return null;
  }

  const posOrder: Record<string, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3, SUB: 4 };

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        {badge && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badge} alt="" className="w-5 h-5 object-contain" />
        )}
        <span className="text-sm font-bold text-white">{teamName}</span>
        {formation && (
          <span className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
            {formation}
          </span>
        )}
      </div>

      {/* Starters */}
      <div className="grid grid-cols-1 gap-0.5">
        {lineup.starters
          .sort((a, b) => (posOrder[a.position] ?? 9) - (posOrder[b.position] ?? 9))
          .map((p, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white/5">
              <span className="text-[9px] font-bold text-gray-500 w-16 shrink-0 uppercase truncate leading-tight">
                {p.position}
              </span>
              <span className="text-xs text-gray-200">{p.name}</span>
            </div>
          ))}
      </div>

      {/* Substitutes */}
      {lineup.substitutes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 block">
            Substitutes
          </span>
          <div className="grid grid-cols-1 gap-0.5">
            {lineup.substitutes.map((p, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 px-2">
                <span className="text-[10px] font-bold text-gray-600 w-6 shrink-0">SUB</span>
                <span className="text-xs text-gray-400">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main drawer
// ---------------------------------------------------------------------------

export default function SoccerMatchDrawer({
  isOpen,
  onClose,
  eventId,
  isMobile = false,
}: SoccerMatchDrawerProps) {
  const [data, setData] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"stats" | "lineups" | "timeline">("stats");

  useEffect(() => {
    if (!isOpen || !eventId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/sports/event-details?event_id=${encodeURIComponent(eventId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setData(json as EventDetails);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[SoccerMatchDrawer] error:", err);
        setError("Could not load match details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, eventId]);

  if (!isOpen) return null;

  const hasStats = (data?.statistics?.length ?? 0) > 0;
  const hasLineups =
    (data?.home_lineup?.starters?.length ?? 0) > 0 ||
    (data?.away_lineup?.starters?.length ?? 0) > 0;
  const hasTimeline = (data?.timeline?.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-[250] flex items-stretch justify-end">
      {/* Backdrop */}
      <button
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close match details"
      />

      {/* Drawer panel */}
      <div
        className={`relative z-10 bg-[#0a0f0d] border-l border-gray-800 shadow-2xl overflow-y-auto ${
          isMobile ? "w-full" : "w-full max-w-lg"
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-[#0a0f0d]/95 backdrop-blur border-b border-gray-800">
          <h3 className="text-white font-bold text-sm">Match Details</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition text-gray-300 hover:text-white"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center p-8 text-gray-400 text-sm">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-6 text-center text-red-400 text-sm">{error}</div>
        )}

        {/* Content */}
        {data && !loading && (
          <div className="p-4">
            {/* Not available state */}
            {!data.available && (
              <div className="text-center py-8">
                <div className="text-gray-500 text-sm">
                  Match details not available yet.
                </div>
                <div className="text-gray-600 text-xs mt-1">
                  Data will appear once the match starts or is completed.
                </div>
              </div>
            )}

            {data.available && (
              <>
                {/* Tab switcher */}
                {(hasStats || hasLineups || hasTimeline) && (
                  <div className="flex gap-1 mb-5 p-0.5 rounded-lg bg-white/5">
                    <button
                      onClick={() => setTab("stats")}
                      className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${
                        tab === "stats"
                          ? "bg-pump-green/20 text-pump-green"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      Statistics
                    </button>
                    <button
                      onClick={() => setTab("timeline")}
                      className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${
                        tab === "timeline"
                          ? "bg-pump-green/20 text-pump-green"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      Timeline
                    </button>
                    <button
                      onClick={() => setTab("lineups")}
                      className={`flex-1 py-2 text-xs font-semibold rounded-md transition ${
                        tab === "lineups"
                          ? "bg-pump-green/20 text-pump-green"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      Lineups
                    </button>
                  </div>
                )}

                {/* Statistics tab */}
                {tab === "stats" && (
                  <div>
                    {hasStats ? (
                      <>
                        {/* Header with team names */}
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-1.5">
                            {data.home_badge && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={data.home_badge} alt="" className="w-4 h-4 object-contain" />
                            )}
                            <span className="text-xs font-semibold text-gray-300 truncate max-w-[100px]">
                              {data.home_team}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-gray-300 truncate max-w-[100px] text-right">
                              {data.away_team}
                            </span>
                            {data.away_badge && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={data.away_badge} alt="" className="w-4 h-4 object-contain" />
                            )}
                          </div>
                        </div>

                        {data.statistics.map((stat, i) => (
                          <StatBar key={i} stat={stat} />
                        ))}
                      </>
                    ) : (
                      <div className="text-center py-6 text-gray-500 text-sm">
                        Statistics not available yet.
                      </div>
                    )}
                  </div>
                )}

                {/* Timeline tab */}
                {tab === "timeline" && (
                  <div>
                    {hasTimeline ? (
                      <div className="space-y-0">
                        {data.timeline.map((t, i) => {
                          const icon =
                            t.type.toLowerCase() === "goal"
                              ? "⚽"
                              : t.type.toLowerCase() === "card" && t.detail.toLowerCase().includes("yellow")
                              ? "🟨"
                              : t.type.toLowerCase() === "card" && t.detail.toLowerCase().includes("red")
                              ? "🟥"
                              : t.type.toLowerCase() === "subst"
                              ? "🔄"
                              : "•";
                          return (
                            <div
                              key={i}
                              className={`flex items-start gap-3 py-2.5 px-2 rounded-lg ${
                                t.type.toLowerCase() === "goal" ? "bg-pump-green/5" : ""
                              } ${t.isHome ? "" : "flex-row-reverse text-right"}`}
                            >
                              <span className="text-xs font-mono text-gray-500 tabular-nums w-8 shrink-0 text-center">
                                {t.minute}&apos;
                              </span>
                              <span className="text-sm shrink-0">{icon}</span>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-200 truncate">
                                  {t.player}
                                </div>
                                {t.assist && (
                                  <div className="text-[10px] text-gray-500">
                                    Assist: {t.assist}
                                  </div>
                                )}
                                <div className="text-[10px] text-gray-600">{t.detail}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-gray-500 text-sm">
                        Timeline not available yet.
                      </div>
                    )}
                  </div>
                )}

                {/* Lineups tab */}
                {tab === "lineups" && (
                  <div>
                    {hasLineups ? (
                      <>
                        <SectionTitle>Home</SectionTitle>
                        <LineupSection
                          lineup={data.home_lineup}
                          teamName={data.home_team}
                          formation={data.home_formation}
                          badge={data.home_badge}
                        />

                        <SectionTitle>Away</SectionTitle>
                        <LineupSection
                          lineup={data.away_lineup}
                          teamName={data.away_team}
                          formation={data.away_formation}
                          badge={data.away_badge}
                        />
                      </>
                    ) : (
                      <div className="text-center py-6 text-gray-500 text-sm">
                        Lineups not available yet.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
