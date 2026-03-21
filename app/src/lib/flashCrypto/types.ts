export type FlashCryptoCampaignStatus = "running" | "stopped" | "completed";

export type FlashCryptoCampaign = {
  id: string;
  type: "flash_crypto_price";
  status: FlashCryptoCampaignStatus;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri: string | null;
  durationMinutes: number;
  launchIntervalMinutes: number;
  totalMarkets: number;
  launchedCount: number;
  nextLaunchAt: number; // ms epoch
  startedAt: string;
  stoppedAt: string | null;
  lastError: string | null;
  marketIds: string[]; // linked market addresses
};

export type FlashCryptoPendingResolution = {
  marketAddress: string;
  marketId: string | null;
  liveMicroId: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  priceStart: number;
  priceEnd: number;
  durationMinutes: number;
  autoResolvedOutcome: "YES" | "NO";
  resolutionStatus: "pending_admin_confirmation" | "proposed";
  windowEnd: string;
  resolvedAt: string | null;
};

export const FLASH_CRYPTO_MICRO_TYPE = "flash_crypto_price";
