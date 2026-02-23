import { NextResponse } from "next/server";
import { cachedWithTtl } from "@/lib/cache";
import { getServerSupabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_TTL_MS = 5_000;
const ACTIVE_STATUSES = ["live", "locked"] as const;

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
    "Cache-Control": "s-maxage=5, stale-while-revalidate=15",
  });
}

export async function GET() {
  try {
    const payload = await cachedWithTtl("live:sessions-map", CACHE_TTL_MS, async () => {
      const supabase = getServerSupabase();
      const { data, error } = await runWithRetry<any[]>(async () =>
        await supabase
          .from("live_sessions")
          .select("id,market_address,status,created_at")
          .in("status", [...ACTIVE_STATUSES])
          .order("created_at", { ascending: false })
          .limit(200)
      );
      if (error) throw error;

      const map: Record<string, string> = {};
      for (const row of (data || []) as { id: string; market_address: string }[]) {
        if (row?.market_address && !map[row.market_address]) {
          map[row.market_address] = row.id;
        }
      }

      return { map };
    });

    return NextResponse.json(payload, { headers: cacheHeaders() });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load live sessions map", map: {} },
      { status: 500, headers: cacheHeaders() }
    );
  }
}
