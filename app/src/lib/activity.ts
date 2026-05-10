// app/src/lib/activity.ts
//
// Shared "recent activity" data path. Mirrors the queries that
// app/src/app/dashboard/page.tsx already issues against Supabase
// (see safeFetchUserTransactions / safeFetchMarketsByAddresses there)
// so the profile page can render the same kind of activity list for
// any wallet, not just the connected one.

import { supabase } from "@/lib/supabaseClient";
import { lamportsToSol } from "@/utils/solana";
import { outcomeLabelFromMarket } from "@/utils/outcomes";

type RawTx = {
  id?: string | number;
  created_at?: string | null;
  market_id?: string | null;
  market_address?: string | null;
  user_address?: string | null;
  is_buy?: boolean | null;
  is_yes?: boolean | null;
  amount?: number | string | null;
  cost?: number | string | null;
  tx_signature?: string | null;
  outcome_index?: number | null;
  shares?: number | string | null;
  outcome_name?: string | null;
  tx_type?: string | null;
};

type RawMarket = {
  id?: string;
  market_address?: string | null;
  question?: string | null;
  outcome_names?: any;
};

export type ActivityRow = {
  id: string;
  title: string;
  marketAddress: string;
  marketQuestion: string;
  sig: string;
  costSol: number;
  createdAt: Date | null;
};

function toNum(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** Same fallback ladder as dashboard's safeFetchUserTransactions. */
async function fetchUserTransactions(
  walletAddress: string,
  limit = 80,
): Promise<RawTx[]> {
  const trySelects = [
    "id,created_at,market_id,market_address,user_address,is_buy,is_yes,amount,cost,tx_signature,outcome_index,shares,outcome_name,tx_type",
    "id,created_at,market_id,market_address,user_address,is_buy,is_yes,amount,cost,tx_signature,outcome_index,shares,outcome_name",
    "id,created_at,market_id,market_address,user_address,is_buy,is_yes,amount,cost,tx_signature",
  ];
  for (const sel of trySelects) {
    const { data, error } = await supabase
      .from("transactions")
      .select(sel)
      .eq("user_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!error) return ((data as RawTx[]) || []);
    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist")) {
      console.error("activity.fetchUserTransactions error:", error);
      return [];
    }
  }
  return [];
}

/** Same fallback ladder as dashboard's safeFetchMarketsByAddresses, scoped to fields we need. */
async function fetchMarketsByAddresses(addrs: string[]): Promise<RawMarket[]> {
  const uniq = Array.from(new Set(addrs.map(String).filter(Boolean))).slice(0, 200);
  if (!uniq.length) return [];
  const trySelects = [
    "id,market_address,question,outcome_names",
    "id,market_address,question",
  ];
  for (const sel of trySelects) {
    const { data, error } = await supabase
      .from("markets")
      .select(sel)
      .in("market_address", uniq);
    if (!error) return ((data as RawMarket[]) || []);
    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist") && !msg.includes("column")) {
      console.error("activity.fetchMarketsByAddresses error:", error);
      return [];
    }
  }
  return [];
}

function buildActivityRows(
  txs: RawTx[],
  marketsByAddr: Map<string, RawMarket>,
): ActivityRow[] {
  return txs
    .filter((t) => !t.tx_type || t.tx_type === "trade")
    .map((t) => {
      const mk = t.market_address ? marketsByAddr.get(String(t.market_address)) : null;
      const marketAddress = String(mk?.market_address || t.market_address || "");
      const marketQuestion = String(mk?.question || "(Market)");
      const side = t.is_buy ? "BUY" : "SELL";
      const shares =
        t.shares != null ? Math.floor(toNum(t.shares)) : Math.floor(toNum(t.amount));
      const names = (mk?.outcome_names || null) as string[] | null;
      const outcomeIndex =
        t.outcome_index != null
          ? Number(t.outcome_index)
          : t.is_yes == null
          ? null
          : t.is_yes
          ? 0
          : 1;
      const outcomeLabel = outcomeLabelFromMarket(
        { outcome_names: names },
        { outcomeIndex, isYes: t.is_yes ?? null, txOutcomeName: t.outcome_name ?? null },
      );
      const title = `${side} • ${outcomeLabel} • ${shares} shares`;
      const costSol = lamportsToSol(toNum(t.cost));
      const createdAt = t.created_at ? new Date(t.created_at) : null;
      return {
        id: String(t.id || t.tx_signature || Math.random()),
        title,
        marketAddress,
        marketQuestion,
        sig: String(t.tx_signature || ""),
        costSol,
        createdAt,
      };
    });
}

/** End-to-end helper: fetches transactions + related markets and builds rows. */
export async function fetchUserActivityRows(
  wallet: string,
  limit = 80,
): Promise<ActivityRow[]> {
  if (!wallet) return [];
  const txs = await fetchUserTransactions(wallet, limit);
  const addrs = Array.from(
    new Set(txs.map((t) => String(t.market_address || "")).filter(Boolean)),
  );
  const markets = addrs.length ? await fetchMarketsByAddresses(addrs) : [];
  const map = new Map<string, RawMarket>();
  for (const m of markets) {
    if (m.market_address) map.set(String(m.market_address), m);
  }
  return buildActivityRows(txs, map);
}
