export type MarketSource = "sports" | "crypto" | "traffic";

export type TrafficFlashDurationSec = 60 | 180 | 300;

export type TrafficRoundParams = {
  threshold: number;
  durationSec: TrafficFlashDurationSec;
  cameraId: string;
};

export const TRAFFIC_FLASH_TYPE = "flash_traffic";
export const TRAFFIC_FLASH_MARKET_MODE = "flash_traffic";
