// src/lib/transactions.ts
import { supabase } from "@/lib/supabaseClient";

export type TxWithMarket = {
  id: string;
  created_at: string;

  // selon ta table
  market_id?: string | null;
  market_address?: string | null;

  user_address?: string | null;
  wallet?: string | null;
  trader?: string | null;

  side: "buy" | "sell";
  outcome_index: number;
  shares: number;

  // optionnel
  cost?: number | null;
  tx_signature?: string | null;

  // join markets
  market_question?: string | null;
  market_link_address?: string | null;
};

export async function fetchUserTransactions(walletAddress: string, limit = 50): Promise<TxWithMarket[]> {
  if (!walletAddress) return [];

  // ⚠️ OR supabase: "col.eq.val,col.eq.val"
  const orFilter = [
    `user_address.eq.${walletAddress}`,
    `wallet.eq.${walletAddress}`,
    `trader.eq.${walletAddress}`,
  ].join(",");

  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      id,
      created_at,
      market_id,
      market_address,
      user_address,
      wallet,
      trader,
      side,
      outcome_index,
      shares,
      cost,
      tx_signature,
      market:markets (
        question,
        market_address
      )
    `
    )
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("fetchUserTransactions error:", error);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: String(row.id),
    created_at: String(row.created_at),

    market_id: row.market_id ?? null,
    market_address: row.market_address ?? null,

    user_address: row.user_address ?? null,
    wallet: row.wallet ?? null,
    trader: row.trader ?? null,

    side: row.side,
    outcome_index: Number(row.outcome_index ?? 0),
    shares: Number(row.shares ?? row.amount ?? 0), // fallback si ta colonne s'appelle amount
    cost: row.cost ?? null,
    tx_signature: row.tx_signature ?? null,

    market_question: row.market?.question ?? null,
    market_link_address: row.market?.market_address ?? row.market_address ?? null,
  }));
}