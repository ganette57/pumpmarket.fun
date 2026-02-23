import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const FEATURED_POOL_LIMIT = 20;
const GRID_DEFAULT_LIMIT = 24;
const GRID_MAX_LIMIT = 100;

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

function homeSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) throw new Error("Missing Supabase env for Home API");
  return createClient(url, key, { auth: { persistSession: false } });
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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = String(sp.get("kind") || "grid").toLowerCase();

  if (kind !== "featured" && kind !== "grid") {
    return NextResponse.json(
      { error: "Invalid kind. Use featured or grid." },
      { status: 400, headers: cacheHeaders() }
    );
  }

  try {
    const supabase = homeSupabase();

    if (kind === "featured") {
      const limit = clampInt(sp.get("limit"), FEATURED_POOL_LIMIT, 1, 50);
      const { data, error } = await runWithRetry<any[]>(async () =>
        await supabase
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
          .limit(limit)
      );

      if (error) {
        return NextResponse.json(
          { error: error.message || "Failed to load featured markets" },
          { status: 500, headers: cacheHeaders() }
        );
      }

      const items = data || [];
      return NextResponse.json(
        { kind: "featured", items, offset: 0, limit, hasMore: items.length === limit },
        { headers: cacheHeaders() }
      );
    }

    const offset = clampInt(sp.get("offset"), 0, 0, 100000);
    const limit = clampInt(sp.get("limit"), GRID_DEFAULT_LIMIT, 1, GRID_MAX_LIMIT);
    const to = offset + limit - 1;

    const { data, error } = await runWithRetry<any[]>(async () =>
      await supabase
        .from("markets")
        .select(
          `
          id,
          market_address,
          question,
          category,
          image_url,
          end_date,
          yes_supply,
          no_supply,
          total_volume,
          resolved,
          resolution_status,
          market_type,
          outcome_names,
          sport_trading_state,
          created_at
        `
        )
        .order("created_at", { ascending: false })
        .range(offset, to)
    );

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load grid markets" },
        { status: 500, headers: cacheHeaders() }
      );
    }

    const items = data || [];
    return NextResponse.json(
      { kind: "grid", items, offset, limit, hasMore: items.length === limit },
      { headers: cacheHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal error" },
      { status: 500, headers: cacheHeaders() }
    );
  }
}
