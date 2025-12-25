// app/src/lib/transactions.ts
import { supabase } from "./supabaseClient";

export type LogTxParams = {
  marketId?: string | null;
  marketAddress?: string | null;

  userAddress: string;

  isBuy: boolean;
  isYes?: boolean | null;

  shares: number; // nb de shares achetés/vendus
  cost: number;   // en SOL (ou lamports), mais jamais null
  txSignature: string;

  outcomeIndex?: number | null;
  outcomeName?: string | null;
};

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toNumberOrZero(v: unknown): number {
  const n = toNumberOrNull(v);
  return n === null ? 0 : n;
}

export async function logTransaction(params: LogTxParams) {
  const {
    marketId = null,
    marketAddress = null,
    userAddress,
    isBuy,
    isYes = null,
    shares,
    cost,
    txSignature,
    outcomeIndex = null,
    outcomeName = null,
  } = params;

  // Hard guards (évite d'insérer des lignes cassées)
  if (!txSignature || txSignature.trim().length < 10) {
    console.warn("logTransaction: skip, invalid txSignature", txSignature);
    return;
  }
  if (!userAddress) {
    console.warn("logTransaction: skip, missing userAddress");
    return;
  }

  const sharesNum = toNumberOrZero(shares);
  const costNum = toNumberOrZero(cost);

  // si 0 shares => pas une tx utile, on évite DB noise
  if (sharesNum <= 0) {
    console.warn("logTransaction: skip, shares <= 0", { shares, sharesNum });
    return;
  }

  const idx = toNumberOrNull(outcomeIndex);
  const outcomeIndexSafe =
    idx !== null && Number.isInteger(idx) && idx >= 0 ? idx : null;

  const payload = {
    market_id: marketId,
    market_address: marketAddress,
    user_address: userAddress,

    is_buy: !!isBuy,
    is_yes: isYes,

    // legacy: tu utilisais amount=shares
    amount: sharesNum,

    // nouveau
    shares: sharesNum,
    cost: costNum, // ✅ jamais null
    tx_signature: txSignature,

    outcome_index: outcomeIndexSafe,
    outcome_name: outcomeName ?? null,
  };

  const { error } = await supabase.from("transactions").insert(payload);
  if (error) {
    console.error("logTransaction error:", error, payload);
  }
}