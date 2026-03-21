export type FlashMarketStatus = "active" | "locked" | "resolving" | "finalized" | "cancelled";

export type FlashMarketKind = "sport" | "crypto";

export type FlashMarket = {
  liveMicroId: string;
  providerMatchId: string;
  marketAddress: string;
  marketId: string | null;
  question: string;
  league: string | null;
  sport: string | null;
  providerImageUrl: string | null;
  marketImageUrl: string | null;
  heroImageUrl: string | null;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string | null;
  awayLogo: string | null;
  startScoreHome: number;
  startScoreAway: number;
  currentScoreHome: number;
  currentScoreAway: number;
  minute: number | null;
  windowEnd: string | null;
  loopSequence: number | null;
  loopPhase: string | null;
  remainingSec: number | null;
  status: FlashMarketStatus;
  volume: number;
  createdAt: string;

  // Crypto flash market fields
  kind: FlashMarketKind;
  tokenMint?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenImageUri?: string | null;
  priceStart?: number | null;
  priceEnd?: number | null;
  durationMinutes?: number | null;
};
