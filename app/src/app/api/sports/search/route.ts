import { NextResponse } from "next/server";
import { listUpcomingMatches } from "@/lib/sportsProviders/fixturesProvider";

// ---------------------------------------------------------------------------
// In-memory TTL cache (10 min — sits in front of provider's 15 min cache)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60_000; // 10 minutes
const cache = new Map<string, { ts: number; data: any[] }>();

function getCached(key: string): any[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any[]) {
  cache.set(key, { ts: Date.now(), data });
  // Prune old entries
  if (cache.size > 100) {
    const now = Date.now();
    Array.from(cache.entries()).forEach(([k, v]) => {
      if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
    });
  }
}

// ---------------------------------------------------------------------------
// Shared handler: returns fixture list for a sport (next 7 days).
// q is optional — applied as local substring filter if present.
// ---------------------------------------------------------------------------

async function handleList(sport: string, base_date?: string, q?: string) {
  // Check route-level cache
  const cacheKey = `list:${sport}:${base_date || "today"}:q:${(q || "").toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json({ matches: cached });
  }

  const matches = await listUpcomingMatches({
    sport,
    days: 7,
    base_date: base_date || undefined,
  });

  // Optional server-side text filter (min 3 chars)
  const trimmed = (q || "").trim().toLowerCase();
  const filtered = trimmed.length >= 3
    ? matches.filter((m) => {
        const haystack = `${m.home_team} ${m.away_team} ${m.league}`.toLowerCase();
        return haystack.includes(trimmed);
      })
    : matches;

  setCache(cacheKey, filtered);
  return NextResponse.json({ matches: filtered });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") || "soccer").trim();
  const base_date = searchParams.get("base_date") || undefined;
  const q = searchParams.get("q") || undefined;
  return handleList(sport, base_date, q);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sport = String(body.sport || "soccer").trim();
    const base_date = body.base_date ? String(body.base_date) : undefined;
    const q = body.q ? String(body.q) : undefined;
    return handleList(sport, base_date, q);
  } catch {
    return NextResponse.json({ matches: [] });
  }
}
