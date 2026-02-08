// app/src/lib/sportsProvider.ts
// Sports event provider adapter: types + mock implementation.
// Real provider integration (e.g. API-Sports) will replace the mock later.
import "server-only";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type SportType =
  | "soccer"
  | "basketball"
  | "american_football"
  | "mma"
  | "tennis";

export type EventStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "cancelled"
  | "postponed";

/** Row shape matching public.sport_events */
export type SportEvent = {
  id: string;
  provider: string;
  provider_event_id: string;
  sport: SportType;
  league: string | null;
  home_team: string;
  away_team: string;
  start_time: string; // ISO 8601
  status: EventStatus;
  score: Record<string, unknown> | null;
  last_polled_at: string | null;
  updated_at: string;
};

/** What a provider adapter returns for a single event update */
export type EventUpdate = {
  status: EventStatus;
  score: Record<string, unknown> | null;
};

/* -------------------------------------------------------------------------- */
/*  Provider adapter interface                                                 */
/* -------------------------------------------------------------------------- */

export type ProviderAdapter = {
  name: string;
  fetchEventUpdate: (event: SportEvent) => Promise<EventUpdate | null>;
};

/* -------------------------------------------------------------------------- */
/*  Mock provider                                                              */
/* -------------------------------------------------------------------------- */

const MOCK_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  scheduled: ["scheduled", "scheduled", "live"], // mostly stays scheduled
  live: ["live", "live", "live", "finished"],     // mostly stays live
  finished: ["finished"],                         // terminal
  cancelled: ["cancelled"],                       // terminal
  postponed: ["postponed", "scheduled"],           // can return to scheduled
};

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mockScore(sport: SportType, status: EventStatus): Record<string, unknown> | null {
  if (status === "scheduled" || status === "cancelled" || status === "postponed") {
    return null;
  }
  // Generate plausible random scores
  switch (sport) {
    case "soccer":
      return { home: Math.floor(Math.random() * 4), away: Math.floor(Math.random() * 4) };
    case "basketball":
      return { home: 80 + Math.floor(Math.random() * 40), away: 80 + Math.floor(Math.random() * 40) };
    case "american_football":
      return { home: Math.floor(Math.random() * 7) * 7, away: Math.floor(Math.random() * 7) * 7 };
    case "mma":
      return { winner: randomPick(["home", "away"]), method: randomPick(["KO", "submission", "decision"]) };
    case "tennis":
      return { sets: [randomPick(["6-4", "7-5", "6-3"]), randomPick(["6-4", "7-6", "6-2"])] };
    default:
      return null;
  }
}

export const mockProvider: ProviderAdapter = {
  name: "mock",
  fetchEventUpdate: async (event) => {
    const transitions = MOCK_TRANSITIONS[event.status] ?? [event.status];
    const nextStatus = randomPick(transitions);
    const nextScore = mockScore(event.sport, nextStatus);
    return { status: nextStatus, score: nextScore };
  },
};

/* -------------------------------------------------------------------------- */
/*  Get active provider based on env                                           */
/* -------------------------------------------------------------------------- */

export function getProvider(): ProviderAdapter {
  const mode = (process.env.SPORTS_PROVIDER_MODE || "").trim().toLowerCase();

  if (mode === "mock") {
    return mockProvider;
  }

  // Default: no-op provider (logs and skips)
  return {
    name: "noop",
    fetchEventUpdate: async (_event) => {
      console.log("[sportsProvider] SPORTS_PROVIDER_MODE is not 'mock'; skipping external call.");
      return null;
    },
  };
}
