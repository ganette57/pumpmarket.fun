// app/src/lib/transactions.ts
import { supabase } from "./supabaseClient";

export type LogTxParams = {
  // pour lier à la table markets
  marketId?: string | null;
  marketAddress?: string | null;

  userAddress: string;

  isBuy: boolean;
  // legacy binaire (YES/NO)
  isYes?: boolean | null;

  shares: number;      // nb de shares achetés/vendus
  cost: number;        // en SOL (ou lamports si tu veux, mais soit cohérent)
  txSignature: string;

  // ⚠️ NOUVEAU : multi-choice propre
  outcomeIndex?: number | null;   // 0,1,2...
  outcomeName?: string | null;    // "GPT", "Grok", "BYD", etc.
};

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

  const payload: any = {
    market_id: marketId,
    market_address: marketAddress,
    user_address: userAddress,

    is_buy: isBuy,
    is_yes: isYes,

    // legacy
    amount: shares,
    // nouveau
    shares,
    cost,
    tx_signature: txSignature,

    // multi-choice
    outcome_index: outcomeIndex,
    outcome_name: outcomeName,
  };

  const { error } = await supabase.from("transactions").insert(payload);
  if (error) {
    console.error("logTransaction error:", error);
  }
}