// Shared flash-market creation used by /live/new (first market) and the
// in-HUD "Next Market" sheet (subsequent markets in the same live session).
// This is just an orchestration of the EXISTING on-chain `createMarket`
// instruction + the EXISTING `indexMarket` Supabase helper — no new
// smart-contract or backend logic, no change to creation mechanics.

import {
  Keypair,
  PublicKey,
  SystemProgram,
  type Connection,
  type Transaction,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { sendSignedTx } from "@/lib/solanaSend";
import { indexMarket } from "@/lib/markets";
import { computeFlashMarketWindow } from "@/lib/liveFlashWindows";

// Same on-chain market defaults as /create + /live/new.
const DEFAULT_B_SOL = 0.01;
const DEFAULT_MAX_POSITION_BPS = 10_000;
const DEFAULT_MAX_TRADE_SHARES = 5_000_000;
const DEFAULT_COOLDOWN_SECONDS = 0;

export type CreateLiveFlashMarketInput = {
  program: any;
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  title: string;
  /** Outcome labels (binary). The helper enforces exactly 2 outcomes. */
  outcomes: string[];
  /** Duration in minutes from now until the on-chain resolution time. */
  durationMin: number;
};

export type CreateLiveFlashMarketResult = {
  marketAddress: string;
  /** Unix seconds — both the on-chain resolutionTime and Supabase end_date. */
  resolutionTimestamp: number;
  /** Sanitised outcome labels actually written on-chain. */
  outcomes: string[];
  /** T0 — when this market went live. ISO. */
  startedAtIso: string;
  /** T0 + trade window. Trading is rejected at or after this. ISO. */
  lockAtIso: string;
  /** T0 + duration. Same instant as `resolutionTimestamp`. ISO. */
  endAtIso: string;
  /** Duration after normalization onto the supported option list. */
  durationMin: number;
};

export async function createLiveFlashMarket(
  input: CreateLiveFlashMarketInput,
): Promise<CreateLiveFlashMarketResult> {
  const {
    program,
    connection,
    publicKey,
    signTransaction,
    title,
    outcomes: rawOutcomes,
    durationMin,
  } = input;

  const safeTitle = String(title || "").trim().slice(0, 200);
  if (!safeTitle) throw new Error("Market title is required");

  const outcomes = (rawOutcomes ?? []).slice(0, 2).map((o, i) =>
    String(o || "").trim().slice(0, 24) || (i === 0 ? "YES" : "NO"),
  );
  while (outcomes.length < 2) outcomes.push(outcomes.length === 0 ? "YES" : "NO");

  // The market starts NOW. `lockAt` closes trading part-way through; `endAt`
  // is unchanged by it — the trade window never extends the market.
  //
  // This is the ONE creation choke point: the session's first market and
  // every chained market both come through here, so market B can never
  // inherit a timestamp from market A — its whole window is computed from its
  // own T0 and its own duration. Throws on an unsupported duration rather
  // than snapping, because these timestamps are written once and then binding.
  const window = computeFlashMarketWindow(durationMin);
  const dur = window.durationMin;

  const resolutionTimestamp = Math.floor(window.endAt.getTime() / 1000);
  const bLamportsU64 = Math.floor(DEFAULT_B_SOL * 1_000_000_000);

  // 1. On-chain createMarket — identical to /create + /live/new.
  const marketKeypair = Keypair.generate();

  const tx = await (program as any).methods
    .createMarket(
      new BN(resolutionTimestamp),
      outcomes,
      0, // market_type: binary
      new BN(bLamportsU64),
      DEFAULT_MAX_POSITION_BPS,
      new BN(DEFAULT_MAX_TRADE_SHARES),
      new BN(DEFAULT_COOLDOWN_SECONDS),
    )
    .accounts({
      market: marketKeypair.publicKey,
      creator: publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  await sendSignedTx({
    connection,
    tx,
    feePayer: publicKey,
    signTx: signTransaction,
    beforeSign: (t) => t.partialSign(marketKeypair),
  });

  const marketAddress = marketKeypair.publicKey.toBase58();

  // 2. Supabase index — end_date powers the live HUD market countdown and
  // trading_lock_at powers the trade-window countdown AND the authoritative
  // Play lock (play_assert_market_tradable compares it against Postgres
  // now()). Flagged so the main home feed can exclude live-session flash
  // markets.
  await indexMarket({
    market_address: marketAddress,
    question: safeTitle,
    category: "other",
    creator: publicKey.toBase58(),
    end_date: window.endAt.toISOString(),
    trading_lock_at: window.lockAt.toISOString(),
    market_type: 0,
    outcome_names: outcomes,
    outcome_supplies: outcomes.map(() => 0),
    yes_supply: 0,
    no_supply: 0,
    total_volume: 0,
    is_live_session_market: true,
  } as any);

  return {
    marketAddress,
    resolutionTimestamp,
    outcomes,
    startedAtIso: window.startedAt.toISOString(),
    lockAtIso: window.lockAt.toISOString(),
    endAtIso: window.endAt.toISOString(),
    durationMin: dur,
  };
}
