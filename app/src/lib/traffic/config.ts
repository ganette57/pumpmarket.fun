export const TRAFFIC_CAMERAS = [
  {
    id: "nyc-1",
    name: "NYC Midtown",
    streamUrl: "https://...",
  },
] as const;

export type TrafficCamera = (typeof TRAFFIC_CAMERAS)[number];
