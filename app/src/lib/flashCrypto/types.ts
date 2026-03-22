export type FlashCryptoCampaignStatus = "running" | "stopped" | "completed";
export type FlashCryptoMode = "price" | "graduation";
export type FlashCryptoMicroType = "flash_crypto_price" | "flash_crypto_graduation";
export type FlashCryptoSourceType = "pump_fun" | "major";
export type FlashCryptoDurationMinutes = 1 | 3 | 5 | 10 | 30 | 60;

export type FlashCryptoCampaign = {
  id: string;
  type: FlashCryptoMicroType;
  mode: FlashCryptoMode;
  status: FlashCryptoCampaignStatus;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri: string | null;
  sourceType?: FlashCryptoSourceType;
  majorSymbol?: string | null;
  majorPair?: string | null;
  durationMinutes: FlashCryptoDurationMinutes;
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
  progressStart: number | null;
  progressEnd: number | null;
  didGraduateEnd: boolean | null;
  sourceType?: FlashCryptoSourceType;
  majorSymbol?: string | null;
  majorPair?: string | null;
  durationMinutes: number;
  mode: FlashCryptoMode;
  autoResolvedOutcome: "YES" | "NO";
  resolutionStatus: "pending_admin_confirmation" | "proposed";
  windowEnd: string;
  resolvedAt: string | null;
};

export const FLASH_CRYPTO_MICRO_TYPE = "flash_crypto_price";
export const FLASH_CRYPTO_GRADUATION_MICRO_TYPE = "flash_crypto_graduation";
export const FLASH_CRYPTO_MICRO_TYPES = [
  FLASH_CRYPTO_MICRO_TYPE,
  FLASH_CRYPTO_GRADUATION_MICRO_TYPE,
] as const;
