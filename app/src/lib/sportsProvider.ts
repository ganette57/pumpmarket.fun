// src/lib/sportsProvider.ts

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

export type SportEvent = {
  id: string;
  provider: string;
  provider_event_id: string;
  sport: SportType;
  league: string | null;
  home_team: string | null;
  away_team: string | null;
  start_time: string | null;
  status: EventStatus;
  score: Record<string, unknown>;
  last_update: string;
  raw: Record<string, unknown> | null;
  created_at: string;
};

export type EventUpdate = {
  status: EventStatus;
  score: Record<string, unknown>;
  raw?: Record<string, unknown> | null;
};

export interface ProviderAdapter {
  name: string;
  updateEvent(event: SportEvent): Promise<EventUpdate | null>;
}

/* -------------------------------------------------------------------------- */
/*  Mock provider                                                              */
/* -------------------------------------------------------------------------- */

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function mockScoreForSport(sport: SportType): Record<string, unknown> {
  switch (sport) {
    case "soccer":
      return { home: randomInt(0, 4), away: randomInt(0, 3) };
    case "basketball":
      return { home: randomInt(70, 130), away: randomInt(70, 130) };
    case "american_football":
      return { home: randomInt(0, 7) * 7, away: randomInt(0, 7) * 7 };
    case "mma":
      return { round: randomInt(1, 5), method: Math.random() > 0.5 ? "KO" : "Decision" };
    case "tennis":
      return {
        sets: [
          [randomInt(0, 7), randomInt(0, 7)],
          [randomInt(0, 7), randomInt(0, 7)],
        ],
      };
    default:
      return {};
  }
}

const NEXT_STATUS: Record<string, EventStatus | null> = {
  scheduled: "live",
  live: "finished",
  finished: null,
  cancelled: null,
  postponed: null,
};

const mockProvider: ProviderAdapter = {
  name: "mock",

  async updateEvent(event: SportEvent): Promise<EventUpdate | null> {
    const next = NEXT_STATUS[event.status];
    // 40% chance of transitioning on each poll
    if (!next || Math.random() > 0.4) return null;

    return {
      status: next,
      score: next === "live" || next === "finished"
        ? mockScoreForSport(event.sport)
        : event.score,
    };
  },
};

/* -------------------------------------------------------------------------- */
/*  Noop provider                                                              */
/* -------------------------------------------------------------------------- */

const noopProvider: ProviderAdapter = {
  name: "noop",
  async updateEvent(): Promise<EventUpdate | null> {
    return null;
  },
};

/* -------------------------------------------------------------------------- */
/*  Factory                                                                    */
/* -------------------------------------------------------------------------- */

export function getProvider(): ProviderAdapter {
  const mode = process.env.SPORTS_PROVIDER_MODE || "noop";
  switch (mode) {
    case "mock":
      return mockProvider;
    default:
      return noopProvider;
  }
}
