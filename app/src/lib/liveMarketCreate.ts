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

  const dur = Math.max(1, Math.floor(Number(durationMin) || 0));
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error("Duration must be a positive number of minutes");
  }

  const outcomes = (rawOutcomes ?? []).slice(0, 2).map((o, i) =>
    String(o || "").trim().slice(0, 24) || (i === 0 ? "YES" : "NO"),
  );
  while (outcomes.length < 2) outcomes.push(outcomes.length === 0 ? "YES" : "NO");

  const resolutionTimestamp = Math.floor(Date.now() / 1000) + dur * 60;
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

  // 2. Supabase index — end_date powers the live HUD countdown.
  await indexMarket({
    market_address: marketAddress,
    question: safeTitle,
    category: "other",
    creator: publicKey.toBase58(),
    end_date: new Date(resolutionTimestamp * 1000).toISOString(),
    market_type: 0,
    outcome_names: outcomes,
    outcome_supplies: outcomes.map(() => 0),
    yes_supply: 0,
    no_supply: 0,
    total_volume: 0,
  } as any);

  return { marketAddress, resolutionTimestamp, outcomes };
}
