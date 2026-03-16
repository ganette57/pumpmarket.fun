import "server-only";

export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta" | "unknown";

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = env(name).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function normalizeCluster(raw: string): SolanaCluster {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s === "mainnet" || s === "mainnet-beta") return "mainnet-beta";
  if (s === "devnet") return "devnet";
  if (s === "testnet") return "testnet";
  return "unknown";
}

function inferClusterFromRpc(endpoint: string): SolanaCluster {
  const e = String(endpoint || "").toLowerCase();
  if (!e) return "unknown";
  if (e.includes("devnet")) return "devnet";
  if (e.includes("testnet")) return "testnet";
  if (e.includes("mainnet")) return "mainnet-beta";
  return "unknown";
}

export type LiveMicroFlags = {
  enabled: boolean;
  devOnly: boolean;
  operatorEnabled: boolean;
  allowedCluster: SolanaCluster;
  currentCluster: SolanaCluster;
  triggerToken: string;
};

export function getLiveMicroFlags(): LiveMicroFlags {
  const explicitCluster = normalizeCluster(env("NEXT_PUBLIC_SOLANA_CLUSTER"));

  const rpcCandidates = [
    env("SOLANA_RPC"),
    env("LIVE_MICRO_RPC_URL"),
    env("NEXT_PUBLIC_RPC_DEVNET"),
    env("NEXT_PUBLIC_SOLANA_RPC"),
    env("NEXT_PUBLIC_SOLANA_RPC_URL"),
  ];
  const inferredCluster = rpcCandidates
    .map((x) => inferClusterFromRpc(x))
    .find((x) => x !== "unknown") || "unknown";

  const currentCluster = explicitCluster !== "unknown" ? explicitCluster : inferredCluster;

  const allowedCluster = normalizeCluster(env("LIVE_MICRO_ALLOWED_CLUSTER") || "devnet");

  return {
    enabled: boolEnv("ENABLE_LIVE_MICRO_MARKETS", false),
    devOnly: boolEnv("LIVE_MICRO_MARKETS_DEV_ONLY", true),
    operatorEnabled: boolEnv("LIVE_MICRO_OPERATOR_ENABLED", false),
    allowedCluster,
    currentCluster,
    triggerToken: env("LIVE_MICRO_TRIGGER_TOKEN"),
  };
}

export function assertLiveMicroGuards(opts?: { requireOperator?: boolean }): LiveMicroFlags {
  const requireOperator = opts?.requireOperator !== false;
  const flags = getLiveMicroFlags();

  if (!flags.enabled) {
    throw new Error("Live micro-markets are disabled (ENABLE_LIVE_MICRO_MARKETS=false)");
  }

  if (flags.devOnly && flags.currentCluster !== "devnet") {
    throw new Error(`Live micro-markets are dev-only and refused on cluster=${flags.currentCluster}`);
  }

  if (flags.allowedCluster === "unknown") {
    throw new Error("LIVE_MICRO_ALLOWED_CLUSTER must be set to a valid cluster (expected: devnet)");
  }

  if (flags.currentCluster !== flags.allowedCluster) {
    throw new Error(
      `Live micro-markets refused: current cluster=${flags.currentCluster}, allowed=${flags.allowedCluster}`,
    );
  }

  if (requireOperator && !flags.operatorEnabled) {
    throw new Error("Operator is disabled (LIVE_MICRO_OPERATOR_ENABLED=false)");
  }

  const operatorKey = env("LIVE_MICRO_OPERATOR_PRIVATE_KEY");
  if (requireOperator && !operatorKey) {
    throw new Error("Missing LIVE_MICRO_OPERATOR_PRIVATE_KEY");
  }

  return flags;
}

export function getLiveMicroWindowMinutes(): number {
  const raw = Number(env("LIVE_MICRO_WINDOW_MINUTES") || "5");
  if (!Number.isFinite(raw)) return 5;
  return Math.max(1, Math.min(15, Math.floor(raw)));
}

function intEnv(name: string, fallback: number): number {
  const raw = Number(env(name));
  if (!Number.isFinite(raw)) return fallback;
  return Math.floor(raw);
}

export type LiveMicroSoccerLoopConfig = {
  firstHalfMaxMarkets: number;
  secondHalfMaxMarkets: number;
  halftimePauseMinutes: number;
  hardStopMinute: number;
  hardStopMaxMatchMinutes: number;
  maxActiveMatchLoops: number;
};

export function getLiveMicroSoccerLoopConfig(): LiveMicroSoccerLoopConfig {
  return {
    firstHalfMaxMarkets: Math.max(1, Math.min(20, intEnv("LIVE_MICRO_SOCCER_FIRST_HALF_MAX_MARKETS", 9))),
    secondHalfMaxMarkets: Math.max(1, Math.min(20, intEnv("LIVE_MICRO_SOCCER_SECOND_HALF_MAX_MARKETS", 9))),
    halftimePauseMinutes: Math.max(1, Math.min(60, intEnv("LIVE_MICRO_SOCCER_HALFTIME_PAUSE_MINUTES", 20))),
    hardStopMinute: Math.max(90, Math.min(150, intEnv("LIVE_MICRO_SOCCER_HARD_STOP_MINUTE", 118))),
    hardStopMaxMatchMinutes: Math.max(90, Math.min(240, intEnv("LIVE_MICRO_SOCCER_HARD_STOP_MAX_MATCH_MINUTES", 130))),
    maxActiveMatchLoops: Math.max(1, Math.min(10, intEnv("LIVE_MICRO_MAX_ACTIVE_MATCH_LOOPS", 3))),
  };
}

export type LiveMicroAutoTickConfig = {
  enabled: boolean;
  intervalMs: number;
  limit: number;
  runOnStart: boolean;
  verboseLogs: boolean;
  disabledReason: string | null;
};

export function getLiveMicroAutoTickConfig(): LiveMicroAutoTickConfig {
  const explicitEnabledRaw = env("LIVE_MICRO_AUTO_TICK_ENABLED");
  const enabled = explicitEnabledRaw
    ? boolEnv("LIVE_MICRO_AUTO_TICK_ENABLED", false)
    : process.env.NODE_ENV !== "production";

  if (!enabled) {
    return {
      enabled: false,
      intervalMs: 15_000,
      limit: 20,
      runOnStart: true,
      verboseLogs: process.env.NODE_ENV !== "production",
      disabledReason: "LIVE_MICRO_AUTO_TICK_ENABLED=false",
    };
  }

  const inBuildPhase = String(process.env.NEXT_PHASE || "").includes("phase-production-build");
  if (inBuildPhase) {
    return {
      enabled: false,
      intervalMs: 15_000,
      limit: 20,
      runOnStart: true,
      verboseLogs: false,
      disabledReason: "disabled during build phase",
    };
  }

  const intervalMs = Math.max(10_000, Math.min(120_000, intEnv("LIVE_MICRO_AUTO_TICK_INTERVAL_MS", 15_000)));
  const limit = Math.max(1, Math.min(100, intEnv("LIVE_MICRO_AUTO_TICK_LIMIT", 20)));

  return {
    enabled: true,
    intervalMs,
    limit,
    runOnStart: boolEnv("LIVE_MICRO_AUTO_TICK_RUN_ON_START", true),
    verboseLogs: boolEnv("LIVE_MICRO_AUTO_TICK_VERBOSE", process.env.NODE_ENV !== "production"),
    disabledReason: null,
  };
}
