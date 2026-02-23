import { NextRequest, NextResponse } from "next/server";
import { cachedWithTtl } from "@/lib/cache";
import { getServerSupabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 30;
const CACHE_TTL_MS = 2_500;

type TxRow = {
  id: string;
  created_at: string;
  is_buy: boolean;
  shares: number | string | null;
  outcome_name: string | null;
  market_address: string | null;
};

type MarketRow = {
  market_address: string;
  question: string | null;
};

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: any): boolean {
  const code = String(error?.code || "").trim();
  const status = Number(error?.status || error?.statusCode || 0);
  const msg = String(error?.message || "").toLowerCase();
  return (
    code === "57014" ||
    status === 500 ||
    msg.includes("statement timeout") ||
    msg.includes("canceling statement due to statement timeout")
  );
}

async function runWithRetry<T>(
  run: () => Promise<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any }> {
  const first = await run();
  if (!first.error) return first;
  if (!isRetryable(first.error)) return first;
  await delay(250);
  return run();
}

function cacheHeaders() {
  return new Headers({
    "Cache-Control": "s-maxage=3, stale-while-revalidate=10",
  });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = clampInt(sp.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const cacheKey = `live:ticker:${limit}`;

  try {
    const payload = await cachedWithTtl(cacheKey, CACHE_TTL_MS, async () => {
      const supabase = getServerSupabase();

      const { data: txs, error: txErr } = await runWithRetry<TxRow[]>(async () =>
        await supabase
          .from("transactions")
          .select("id,created_at,is_buy,shares,outcome_name,market_address")
          .eq("is_buy", true)
          .order("created_at", { ascending: false })
          .limit(limit)
      );
      if (txErr) throw txErr;

      const cleanTxs = (((txs as any[]) || []) as TxRow[]).filter((r) => r.is_buy);
      const addresses = Array.from(
        new Set(cleanTxs.map((r) => r.market_address).filter((x): x is string => !!x))
      );

      const marketMap = new Map<string, string>();
      if (addresses.length) {
        const { data: mkts, error: mErr } = await runWithRetry<MarketRow[]>(async () =>
          await supabase
            .from("markets")
            .select("market_address,question")
            .in("market_address", addresses)
        );
        if (mErr) throw mErr;
        (((mkts as any[]) || []) as MarketRow[]).forEach((m) => {
          if (m?.market_address) marketMap.set(m.market_address, m.question || "a market");
        });
      }

      const items = cleanTxs.map((r) => ({
        ...r,
        market_question: r.market_address ? marketMap.get(r.market_address) || "a market" : "a market",
      }));

      return { items };
    });

    return NextResponse.json(payload, { headers: cacheHeaders() });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load live ticker", items: [] },
      { status: 500, headers: cacheHeaders() }
    );
  }
}
