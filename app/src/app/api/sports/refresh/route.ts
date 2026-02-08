// app/src/app/api/sports/refresh/route.ts
// Internal poller endpoint: refreshes sport_events cache and auto-ends
// linked live sessions when events finish/cancel.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getProvider, type SportEvent, type EventUpdate } from "@/lib/sportsProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function supabaseAdmin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

function assertRefreshAuth(req: Request) {
  const expected = (process.env.SPORTS_REFRESH_TOKEN || "").trim();
  if (!expected) throw new Error("SPORTS_REFRESH_TOKEN not configured");

  // Accept either header: x-refresh-token or Authorization: Bearer <token>
  const fromHeader = (req.headers.get("x-refresh-token") || "").trim();
  const authHeader = (req.headers.get("authorization") || "").trim();
  const fromBearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (fromHeader !== expected && fromBearer !== expected) {
    throw new Error("Unauthorized");
  }
}

/* -------------------------------------------------------------------------- */
/*  Auto lock/end linked markets + live sessions                               */
/* -------------------------------------------------------------------------- */

async function autoEndLinkedSessions(
  supabase: ReturnType<typeof supabaseAdmin>,
  eventId: string,
): Promise<{ ended: number; errors: string[] }> {
  const errors: string[] = [];
  let ended = 0;

  // Find markets linked to this finished/cancelled sport event
  const { data: markets, error: mErr } = await supabase
    .from("markets")
    .select("market_address")
    .eq("sport_event_id", eventId)
    .eq("market_mode", "sport_live");

  if (mErr) {
    // market_mode column may not exist yet if migration hasn't run
    errors.push(`markets query: ${mErr.message}`);
    return { ended, errors };
  }

  if (!markets || markets.length === 0) return { ended, errors };

  // For each linked market, try to end active live sessions
  for (const m of markets) {
    const addr = m.market_address;

    // Try to update live_sessions — table may not exist yet
    try {
      const { data: sessions, error: sErr } = await supabase
        .from("live_sessions")
        .select("id, status")
        .eq("market_address", addr)
        .in("status", ["live", "locked"]);

      if (sErr) {
        // Table doesn't exist yet — not an error, just skip
        if (sErr.message.includes("does not exist") || sErr.code === "42P01") {
          errors.push(`live_sessions table not found, skipping auto-end for ${addr}`);
          continue;
        }
        errors.push(`live_sessions select for ${addr}: ${sErr.message}`);
        continue;
      }

      if (!sessions || sessions.length === 0) continue;

      for (const s of sessions) {
        const { error: uErr } = await supabase
          .from("live_sessions")
          .update({ status: "ended", updated_at: new Date().toISOString() })
          .eq("id", s.id);

        if (uErr) {
          errors.push(`live_sessions update ${s.id}: ${uErr.message}`);
        } else {
          ended++;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`auto-end for ${addr}: ${msg}`);
    }
  }

  return { ended, errors };
}

/* -------------------------------------------------------------------------- */
/*  POST handler                                                               */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request) {
  let step = "init";

  try {
    step = "auth";
    assertRefreshAuth(req);

    step = "setup";
    const supabase = supabaseAdmin();
    const provider = getProvider();

    // Query events that need polling: scheduled or live, within ±6h window
    step = "select_events";
    const now = new Date();
    const windowStart = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();

    const { data: events, error: selErr } = await supabase
      .from("sport_events")
      .select("*")
      .in("status", ["scheduled", "live"])
      .gte("start_time", windowStart)
      .lte("start_time", windowEnd)
      .limit(50);

    if (selErr) throw selErr;

    if (!events || events.length === 0) {
      return NextResponse.json({ ok: true, provider: provider.name, refreshed: 0, message: "No events in window" });
    }

    step = "poll_events";
    const results: Array<{
      id: string;
      provider_event_id: string;
      ok: boolean;
      changed: boolean;
      autoEnd?: { ended: number; errors: string[] };
      error?: string;
    }> = [];

    for (const row of events) {
      const event = row as SportEvent;

      try {
        const update: EventUpdate | null = await provider.fetchEventUpdate(event);

        if (!update) {
          results.push({ id: event.id, provider_event_id: event.provider_event_id, ok: true, changed: false });
          continue;
        }

        const changed = update.status !== event.status || JSON.stringify(update.score) !== JSON.stringify(event.score);

        if (changed) {
          const { error: updErr } = await supabase
            .from("sport_events")
            .update({
              status: update.status,
              score: update.score,
              last_polled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", event.id);

          if (updErr) {
            results.push({ id: event.id, provider_event_id: event.provider_event_id, ok: false, changed: false, error: updErr.message });
            continue;
          }

          // Auto-end linked sessions if event finished or cancelled
          let autoEnd: { ended: number; errors: string[] } | undefined;
          if (update.status === "finished" || update.status === "cancelled") {
            autoEnd = await autoEndLinkedSessions(supabase, event.id);
          }

          results.push({ id: event.id, provider_event_id: event.provider_event_id, ok: true, changed: true, autoEnd });
        } else {
          // Still update last_polled_at even if nothing changed
          await supabase
            .from("sport_events")
            .update({ last_polled_at: new Date().toISOString() })
            .eq("id", event.id);

          results.push({ id: event.id, provider_event_id: event.provider_event_id, ok: true, changed: false });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ id: event.id, provider_event_id: event.provider_event_id, ok: false, changed: false, error: msg });
      }
    }

    return NextResponse.json({
      ok: true,
      provider: provider.name,
      refreshed: results.filter((r) => r.changed).length,
      total: results.length,
      results,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Unauthorized") ? 401 : 500;
    console.error(`[sports/refresh] step=${step} error:`, msg);
    return NextResponse.json({ ok: false, step, error: msg }, { status });
  }
}
