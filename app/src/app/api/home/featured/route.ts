import { NextRequest, NextResponse } from "next/server";
import { isSportSubcategory } from "@/utils/categories";
import { cachedWithTtl } from "@/lib/cache";
import { getServerSupabase } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FEATURED_POOL_LIMIT = 20;
const FEATURED_MAX_LIMIT = 50;
const CACHE_TTL_MS = 5_000;

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

function cacheHeaders() {
  return new Headers({
    "Cache-Control": "s-maxage=5, stale-while-revalidate=30",
  });
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

function normalizeCategory(raw: string) {
  const category = String(raw || "all").trim().toLowerCase();
  if (!category || category === "all") return "all";
  if (category === "sports" || isSportSubcategory(category)) return "sports";
  return category;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = clampInt(sp.get("limit"), FEATURED_POOL_LIMIT, 1, FEATURED_MAX_LIMIT);
  const category = normalizeCategory(String(sp.get("category") || "all"));
  const cacheKey = `home:featured:${limit}:${category}`;

  try {
    const payload = await cachedWithTtl(cacheKey, CACHE_TTL_MS, async () => {
      const supabase = getServerSupabase();
      let q = supabase
        .from("markets")
        .select(
          `
          id,
          market_address,
          question,
          category,
          image_url,
          end_date,
          creator,
          social_links,
          yes_supply,
          no_supply,
          total_volume,
          resolved,
          resolution_status,
          market_type,
          outcome_names,
          outcome_supplies,
          sport_trading_state,
          created_at
        `
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (category !== "all") {
        q = q.eq("category", category);
      }

      const { data, error } = await runWithRetry<any[]>(async () => await q);
      if (error) {
        throw error;
      }
      return { items: data || [] };
    });

    return NextResponse.json(payload, { headers: cacheHeaders() });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load featured markets", items: [] },
      { status: 500, headers: cacheHeaders() }
    );
  }
}
