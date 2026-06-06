// app/src/app/world-cup/_components/mockData.ts
// MOCK DATA ONLY — no API calls, no real fixtures.

export const GOLD = "#EAB54C";
export const GOLD_SOFT = "#F5C76A";

export type Team = {
  name: string;
  /** Country emoji flag — kept on every mock entry; used as fallback when no badge URL. */
  flag?: string;
  /** Real team badge URL from TheSportsDB. Optional — emoji flag is the fallback. */
  badge?: string | null;
};

export const CHAMPIONSHIP_STATS = {
  prizePool: "$150,000",
  volume: "$27,358,492",
  nextMilestone: "$50,000,000",
  yourRank: "#842",
  topTrader: "@MaxTrader",
  progressPct: 54,
};

/** A single outcome button (3-way: Home / Draw / Away, or 2-way). */
export type MatchOutcome = { label: string; pct: number };

export type LiveMatch = {
  id: string;
  group: string;
  home: Team;
  away: Team;
  scoreHome: number;
  scoreAway: number;
  minute: string;
  markets: number;
  outcomes: MatchOutcome[];
};

export const LIVE_MATCHES: LiveMatch[] = [
  {
    id: "fra-bra",
    group: "Group A",
    home: { name: "France", flag: "🇫🇷" },
    away: { name: "Brazil", flag: "🇧🇷" },
    scoreHome: 1,
    scoreAway: 1,
    minute: "67'",
    markets: 182,
    outcomes: [
      { label: "France", pct: 44 },
      { label: "Draw", pct: 29 },
      { label: "Brazil", pct: 27 },
    ],
  },
  {
    id: "esp-ger",
    group: "Group B",
    home: { name: "Spain", flag: "🇪🇸" },
    away: { name: "Germany", flag: "🇩🇪" },
    scoreHome: 0,
    scoreAway: 1,
    minute: "32'",
    markets: 156,
    outcomes: [
      { label: "Spain", pct: 33 },
      { label: "Draw", pct: 28 },
      { label: "Germany", pct: 39 },
    ],
  },
  {
    id: "arg-por",
    group: "Group C",
    home: { name: "Argentina", flag: "🇦🇷" },
    away: { name: "Portugal", flag: "🇵🇹" },
    scoreHome: 2,
    scoreAway: 2,
    minute: "78'",
    markets: 201,
    outcomes: [
      { label: "Argentina", pct: 41 },
      { label: "Draw", pct: 34 },
      { label: "Portugal", pct: 25 },
    ],
  },
  {
    id: "ned-bel",
    group: "Group D",
    home: { name: "Netherlands", flag: "🇳🇱" },
    away: { name: "Belgium", flag: "🇧🇪" },
    scoreHome: 1,
    scoreAway: 0,
    minute: "54'",
    markets: 142,
    outcomes: [
      { label: "Netherlands", pct: 48 },
      { label: "Draw", pct: 30 },
      { label: "Belgium", pct: 22 },
    ],
  },
];

export type UpcomingMatch = {
  id: string;
  kickoff: string;
  group: string;
  home: Team;
  away: Team;
  markets: number;
  outcomes: MatchOutcome[];
};

export const UPCOMING_MATCHES: UpcomingMatch[] = [
  {
    id: "eng-cro",
    kickoff: "Jun 11 · 18:00",
    group: "Group D",
    home: { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    away: { name: "Croatia", flag: "🇭🇷" },
    markets: 126,
    outcomes: [
      { label: "England", pct: 52 },
      { label: "Draw", pct: 27 },
      { label: "Croatia", pct: 21 },
    ],
  },
  {
    id: "ita-jpn",
    kickoff: "Jun 11 · 21:00",
    group: "Group E",
    home: { name: "Italy", flag: "🇮🇹" },
    away: { name: "Japan", flag: "🇯🇵" },
    markets: 128,
    outcomes: [
      { label: "Italy", pct: 55 },
      { label: "Draw", pct: 26 },
      { label: "Japan", pct: 19 },
    ],
  },
  {
    id: "por-uru",
    kickoff: "Jun 12 · 15:00",
    group: "Group F",
    home: { name: "Portugal", flag: "🇵🇹" },
    away: { name: "Uruguay", flag: "🇺🇾" },
    markets: 112,
    outcomes: [
      { label: "Portugal", pct: 46 },
      { label: "Draw", pct: 29 },
      { label: "Uruguay", pct: 25 },
    ],
  },
  {
    id: "bel-jpn",
    kickoff: "Jun 12 · 18:00",
    group: "Group G",
    home: { name: "Belgium", flag: "🇧🇪" },
    away: { name: "Japan", flag: "🇯🇵" },
    markets: 112,
    outcomes: [
      { label: "Belgium", pct: 50 },
      { label: "Draw", pct: 28 },
      { label: "Japan", pct: 22 },
    ],
  },
];

export type FlashMarketRow = {
  id: string;
  question: string;
  yes: number;
  no: number;
  match: string;
  minute: string;
};

export const FLASH_MARKETS: FlashMarketRow[] = [
  { id: "f1", question: "Goal in next 5 min", yes: 72, no: 28, match: "FRA vs BRA", minute: "67'" },
  { id: "f2", question: "Corner in next 3 min", yes: 61, no: 39, match: "FRA vs BRA", minute: "67'" },
  { id: "f3", question: "Yellow card in next 5 min", yes: 48, no: 52, match: "ESP vs GER", minute: "32'" },
  { id: "f4", question: "Goal before halftime", yes: 33, no: 67, match: "ESP vs GER", minute: "32'" },
];

export type SideMarketRow = {
  id: string;
  question: string;
  outcomes: { label: string; pct: number }[];
};

export const SIDE_MARKETS: SideMarketRow[] = [
  {
    id: "s1",
    question: "Match Winner — France vs Brazil",
    outcomes: [
      { label: "France", pct: 78 },
      { label: "Draw", pct: 15 },
      { label: "Brazil", pct: 7 },
    ],
  },
  {
    id: "s2",
    question: "Both Teams to Score",
    outcomes: [
      { label: "Yes", pct: 61 },
      { label: "No", pct: 39 },
    ],
  },
  {
    id: "s3",
    question: "Total Goals — Over/Under 2.5",
    outcomes: [
      { label: "Over 2.5", pct: 57 },
      { label: "Under 2.5", pct: 43 },
    ],
  },
  {
    id: "s4",
    question: "Brazil to Qualify",
    outcomes: [
      { label: "Yes", pct: 92 },
      { label: "No", pct: 8 },
    ],
  },
  {
    id: "s5",
    question: "Group A Winner",
    outcomes: [
      { label: "Brazil", pct: 62 },
      { label: "Switzerland", pct: 24 },
      { label: "Cameroon", pct: 14 },
    ],
  },
];

export type LeaderboardEntry = {
  rank: number;
  username: string;
  volume: string;
  roi: string;
};

export const LEADERBOARD_TOP5: LeaderboardEntry[] = [
  { rank: 1, username: "@MaxTrader", volume: "$512,430", roi: "+24.58%" },
  { rank: 2, username: "@CryptoLion", volume: "$385,210", roi: "+18.72%" },
  { rank: 3, username: "@GoalHunter", volume: "$310,245", roi: "+15.39%" },
  { rank: 4, username: "@BetMaster", volume: "$256,112", roi: "+12.41%" },
  { rank: 5, username: "@FootTrader", volume: "$198,560", roi: "+11.03%" },
];

export type GroupRow = {
  team: Team;
  played: number;
  win: number;
  draw: number;
  loss: number;
  points: number;
};

export type GroupStanding = {
  name: string;
  rows: GroupRow[];
};

export const GROUPS: GroupStanding[] = [
  {
    name: "Group A",
    rows: [
      { team: { name: "Brazil", flag: "🇧🇷" }, played: 2, win: 2, draw: 0, loss: 0, points: 6 },
      { team: { name: "Switzerland", flag: "🇨🇭" }, played: 2, win: 1, draw: 0, loss: 1, points: 3 },
      { team: { name: "Serbia", flag: "🇷🇸" }, played: 2, win: 0, draw: 1, loss: 1, points: 1 },
      { team: { name: "Cameroon", flag: "🇨🇲" }, played: 2, win: 0, draw: 1, loss: 1, points: 1 },
    ],
  },
  {
    name: "Group B",
    rows: [
      { team: { name: "France", flag: "🇫🇷" }, played: 2, win: 2, draw: 0, loss: 0, points: 6 },
      { team: { name: "Germany", flag: "🇩🇪" }, played: 2, win: 1, draw: 0, loss: 1, points: 3 },
      { team: { name: "Morocco", flag: "🇲🇦" }, played: 2, win: 1, draw: 0, loss: 1, points: 3 },
      { team: { name: "Iran", flag: "🇮🇷" }, played: 2, win: 0, draw: 0, loss: 2, points: 0 },
    ],
  },
  {
    name: "Group C",
    rows: [
      { team: { name: "Argentina", flag: "🇦🇷" }, played: 2, win: 2, draw: 0, loss: 0, points: 6 },
      { team: { name: "Mexico", flag: "🇲🇽" }, played: 2, win: 1, draw: 0, loss: 1, points: 3 },
      { team: { name: "Poland", flag: "🇵🇱" }, played: 2, win: 1, draw: 0, loss: 1, points: 3 },
      { team: { name: "Saudi Arabia", flag: "🇸🇦" }, played: 2, win: 0, draw: 0, loss: 2, points: 0 },
    ],
  },
  {
    name: "Group D",
    rows: [
      { team: { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" }, played: 2, win: 2, draw: 0, loss: 0, points: 6 },
      { team: { name: "Netherlands", flag: "🇳🇱" }, played: 2, win: 1, draw: 0, loss: 1, points: 3 },
      { team: { name: "USA", flag: "🇺🇸" }, played: 2, win: 1, draw: 0, loss: 1, points: 3 },
      { team: { name: "Wales", flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿" }, played: 2, win: 0, draw: 0, loss: 2, points: 0 },
    ],
  },
];

export type BracketMatch = { home: Team | null; away: Team | null; label?: string };

export const KNOCKOUT = {
  r16: [
    { home: { name: "Brazil", flag: "🇧🇷" }, away: { name: "Germany", flag: "🇩🇪" } },
    { home: { name: "France", flag: "🇫🇷" }, away: { name: "Mexico", flag: "🇲🇽" } },
    { home: { name: "Argentina", flag: "🇦🇷" }, away: { name: "Netherlands", flag: "🇳🇱" } },
    { home: { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" }, away: { name: "Switzerland", flag: "🇨🇭" } },
    { home: { name: "Spain", flag: "🇪🇸" }, away: { name: "USA", flag: "🇺🇸" } },
    { home: { name: "Portugal", flag: "🇵🇹" }, away: { name: "Morocco", flag: "🇲🇦" } },
    { home: { name: "Italy", flag: "🇮🇹" }, away: { name: "Poland", flag: "🇵🇱" } },
    { home: { name: "Belgium", flag: "🇧🇪" }, away: { name: "Japan", flag: "🇯🇵" } },
  ] as BracketMatch[],
  qf: [
    { home: { name: "Brazil", flag: "🇧🇷" }, away: { name: "France", flag: "🇫🇷" } },
    { home: { name: "Argentina", flag: "🇦🇷" }, away: { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" } },
    { home: { name: "Spain", flag: "🇪🇸" }, away: { name: "Portugal", flag: "🇵🇹" } },
    { home: { name: "Italy", flag: "🇮🇹" }, away: { name: "Belgium", flag: "🇧🇪" } },
  ] as BracketMatch[],
  sf: [
    { home: { name: "Brazil", flag: "🇧🇷" }, away: { name: "Argentina", flag: "🇦🇷" } },
    { home: { name: "Spain", flag: "🇪🇸" }, away: { name: "Italy", flag: "🇮🇹" } },
  ] as BracketMatch[],
  final: [
    { home: { name: "Brazil", flag: "🇧🇷" }, away: { name: "Spain", flag: "🇪🇸" } },
  ] as BracketMatch[],
};

export const TREASURY = {
  prizePool: "$150,000",
  feesGenerated: "$410,377",
  treasuryBalance: "$410,377 USDC",
  recent: [
    { id: "t1", kind: "Fee", amount: "+$2,348", from: "ESP vs GER markets", time: "2m ago" },
    { id: "t2", kind: "Payout", amount: "−$5,200", from: "Goal in next 5 (settled)", time: "8m ago" },
    { id: "t3", kind: "Fee", amount: "+$1,910", from: "FRA vs BRA markets", time: "14m ago" },
    { id: "t4", kind: "Top-up", amount: "+$25,000", from: "Championship prize pool", time: "1h ago" },
  ],
};
