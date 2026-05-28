// Host live-market resolution.
//
// Reuses the EXISTING creator resolution flow (same as the dashboard):
//   1. the on-chain `proposeResolution(outcomeIndex)` instruction, signed by
//      the host wallet (the on-chain market creator), and
//   2. the existing Supabase propose helper (`/api/markets/propose`).
//
// No new smart-contract or backend logic is introduced here — this just
// orchestrates the two existing pieces so the live pages don't duplicate them.

import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import { sendSignedTx } from "@/lib/solanaSend";
import { proposeResolution } from "@/lib/markets";

// 4h dispute window — same fallback the dashboard uses when no on-chain
// contest deadline is available.
const CONTEST_WINDOW_MS = 4 * 60 * 60 * 1000;

export async function proposeLiveResolution(opts: {
  program: any;
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  marketAddress: string;
  outcomeIndex: number;
}): Promise<void> {
  const {
    program,
    connection,
    publicKey,
    signTransaction,
    marketAddress,
    outcomeIndex,
  } = opts;

  const marketPk = new PublicKey(marketAddress);

  // On-chain proposal (host = creator). Identical call to the dashboard flow.
  const tx = await (program as any).methods
    .proposeResolution(outcomeIndex)
    .accounts({ market: marketPk, creator: publicKey })
    .transaction();

  try {
    await sendSignedTx({
      connection,
      tx,
      signTx: signTransaction,
      feePayer: publicKey,
    });
  } catch (e: any) {
    const msg = String(e?.message || "").toLowerCase();
    // Idempotent: if the chain already has this proposal, keep going to the DB
    // mirror. Anything else is a real failure.
    if (!msg.includes("already been processed")) throw e;
  }

  // Mirror to Supabase via the existing propose API.
  const contestDeadlineIso = new Date(Date.now() + CONTEST_WINDOW_MS).toISOString();
  await proposeResolution({
    market_address: marketAddress,
    proposed_winning_outcome: outcomeIndex,
    contest_deadline_iso: contestDeadlineIso,
  });
}
