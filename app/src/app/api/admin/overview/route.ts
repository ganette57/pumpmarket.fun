import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Connection, PublicKey } from "@solana/web3.js";
import { isAdminRequest } from "@/lib/admin";
import { getLiveMicroFlags, type SolanaCluster } from "@/lib/liveMicro/config";
import { getOperatorPublicKeyBase58 } from "@/lib/liveMicro/operator";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};
const MARKET_BATCH_SIZE = 1000;

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function toNumber(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function rpcForCluster(cluster: SolanaCluster): string {
  const direct = String(process.env.LIVE_MICRO_RPC_URL || process.env.SOLANA_RPC || "").trim();
  if (direct) return direct;

  if (cluster === "mainnet-beta") {
    return String(process.env.NEXT_PUBLIC_RPC_MAINNET || "").trim() || "https://api.mainnet-beta.solana.com";
  }
  if (cluster === "testnet") {
    return String(process.env.NEXT_PUBLIC_RPC_TESTNET || "").trim() || "https://api.testnet.solana.com";
  }
  return (
    String(
      process.env.NEXT_PUBLIC_RPC_DEVNET ||
        process.env.NEXT_PUBLIC_SOLANA_RPC ||
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
        "",
    ).trim() || "https://api.devnet.solana.com"
  );
}

async function getOperatorWalletSnapshot(): Promise<{
  operator_wallet: string | null;
  operator_balance_sol: number | null;
}> {
  let operatorWallet = "";
  try {
    operatorWallet = getOperatorPublicKeyBase58();
  } catch {
    operatorWallet = "";
  }
  if (!operatorWallet) {
    return { operator_wallet: null, operator_balance_sol: null };
  }

  try {
    const flags = getLiveMicroFlags();
    const connection = new Connection(rpcForCluster(flags.currentCluster), "confirmed");
    const lamports = await connection.getBalance(new PublicKey(operatorWallet), "confirmed");
    return {
      operator_wallet: operatorWallet,
      operator_balance_sol: Number((lamports / 1_000_000_000).toFixed(4)),
    };
  } catch {
    return { operator_wallet: operatorWallet, operator_balance_sol: null };
  }
}

type ActionableMarket = {
  market_address: string;
  question: string | null;
  contest_deadline: string | null;
  contest_count: number;
  end_date: string | null;
  proposed_winning_outcome: number | null;
  type: "proposed_no_dispute" | "proposed_disputed" | "no_proposal_24h";
  is_actionable: boolean;
  due_date: string | null;
};

export async function GET(req: Request) {
  const ok = await isAdminRequest(req);
  if (!ok) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  try {
    const markets: any[] = [];
    for (let from = 0; ; from += MARKET_BATCH_SIZE) {
      const to = from + MARKET_BATCH_SIZE - 1;
      const { data: chunk, error: mErr } = await supabase
        .from("markets")
        .select(
          "id, resolved, resolution_status, end_date, total_volume, contest_count, contested, contest_deadline, question, market_address, proposed_winning_outcome, cancelled"
        )
        .order("id", { ascending: true })
        .range(from, to);
      if (mErr) throw mErr;
      if (!chunk?.length) break;
      markets.push(...chunk);
      if (chunk.length < MARKET_BATCH_SIZE) break;
    }

    const now = Date.now();
    const cutoff24h = now - 24 * 60 * 60 * 1000; // Changed from 48h

    let markets_total = 0;
    let markets_open = 0;
    let markets_ended = 0;
    let markets_proposed = 0;
    let markets_finalized = 0;
    let markets_cancelled = 0;

    let volume_sol_total = 0;

    const actionable_markets: ActionableMarket[] = [];

    for (const mk of markets || []) {
      markets_total += 1;

      const status = String(mk.resolution_status || "open").toLowerCase();
      const resolved = !!mk.resolved;
      const cancelled = !!mk.cancelled;

      const endMs = mk.end_date ? new Date(mk.end_date).getTime() : NaN;
      const ended = Number.isFinite(endMs) ? endMs <= now : false;

      volume_sol_total += toNumber(mk.total_volume) / 1e9;

      if (status === "cancelled" || cancelled) markets_cancelled += 1;
      if (status === "finalized" || resolved) markets_finalized += 1;

      // Case A/B: Proposed markets (with or without disputes)
      if (status === "proposed" && !resolved && !cancelled) {
        markets_proposed += 1;

        const contestCount = Number(mk.contest_count || 0) || 0;
        const deadlineMs = mk.contest_deadline ? new Date(mk.contest_deadline).getTime() : NaN;
        const isActionable = Number.isFinite(deadlineMs) && now >= deadlineMs;

        actionable_markets.push({
          market_address: String(mk.market_address || ""),
          question: mk.question ?? null,
          contest_deadline: mk.contest_deadline ?? null,
          contest_count: contestCount,
          end_date: mk.end_date ?? null,
          proposed_winning_outcome: mk.proposed_winning_outcome ?? null,
          type: contestCount > 0 ? "proposed_disputed" : "proposed_no_dispute",
          is_actionable: isActionable,
          due_date: mk.contest_deadline ?? null,
        });
      }

      // Case C: No proposal > 24h (changed from 48h)
      if (status === "open" && !resolved && !cancelled && ended) {
        const is24hPassed = Number.isFinite(endMs) && endMs <= cutoff24h;
        if (is24hPassed) {
          actionable_markets.push({
            market_address: String(mk.market_address || ""),
            question: mk.question ?? null,
            contest_deadline: null,
            contest_count: 0,
            end_date: mk.end_date ?? null,
            proposed_winning_outcome: null,
            type: "no_proposal_24h",
            is_actionable: true,
            due_date: mk.end_date ?? null,
          });
        }
      }

      const closed = resolved || cancelled || status === "proposed" || status === "cancelled" || ended;
      if (!closed) markets_open += 1;
      if (ended) markets_ended += 1;
    }

    actionable_markets.sort((a, b) => {
      if (a.is_actionable !== b.is_actionable) return a.is_actionable ? -1 : 1;
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return (b.contest_count || 0) - (a.contest_count || 0);
    });

    const { count: tx_count, error: txErr } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true });
    if (txErr) throw txErr;

    const { data: traders, error: trErr } = await supabase.from("transactions").select("user_address").limit(5000);
    if (trErr) throw trErr;

    const unique_traders = new Set(
      (traders || []).map((t: any) => String(t.user_address || "")).filter(Boolean)
    ).size;

    let disputes_total = 0;
    let disputes_open = 0;

    for (const mk of markets || []) {
      const count = Number(mk.contest_count || 0) || 0;
      disputes_total += count;

      const status = String(mk.resolution_status || "open").toLowerCase();
      const resolved = !!mk.resolved;

      const deadlineMs = mk.contest_deadline ? new Date(mk.contest_deadline).getTime() : NaN;
      const contestOpen = status === "proposed" && !resolved && Number.isFinite(deadlineMs) && deadlineMs > now;

      if (contestOpen && count > 0) disputes_open += count;
    }

    const operatorSnapshot = await getOperatorWalletSnapshot();

    return NextResponse.json(
      {
        kpi: {
          markets_total,
          markets_open,
          markets_ended,
          markets_proposed,
          markets_finalized,
          markets_cancelled,
          volume_sol_total: Number(volume_sol_total.toFixed(4)),
          tx_count: tx_count || 0,
          unique_traders,
          disputes_open,
          disputes_total,
        },
        actionable_markets,
        operator_wallet: operatorSnapshot.operator_wallet,
        operator_balance_sol: operatorSnapshot.operator_balance_sol,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    console.error("admin overview error", e);
    return NextResponse.json(
      { error: e?.message || "Failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
