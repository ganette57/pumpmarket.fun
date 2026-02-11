import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

// Optional: keep API-Sports enrichment if still wired in your repo.
// If you no longer use it, you can remove these imports + the enrichment block.
import {
  isAvailable as isApiSportsAvailable,
  fetchEvent,
} from "@/lib/sportsProviders/apiSportsProvider";

type Enriched = {
  status?: string;
  score?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  league?: string | null;
  start_time?: string | null;
  end_time?: string | null;
} | null;

function cleanStr(v: any): string {
  return String(v ?? "").trim();
}

function cleanOpt(v: any): string | null {
  const s = cleanStr(v);
  return s ? s : null;
}

function isNonEmptyObject(x: any) {
  return x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length > 0;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Base payload
    const provider = cleanStr(body.provider || "manual") || "manual";
    const provider_event_id_in = cleanOpt(body.provider_event_id);
    const sport = cleanStr(body.sport);
    const home_team = cleanStr(body.home_team);
    const away_team = cleanStr(body.away_team);
    const start_time_in = cleanStr(body.start_time);
    const end_time_in = cleanOpt(body.end_time);
    const league_in = cleanOpt(body.league);
    const raw_in = isNonEmptyObject(body.raw) ? body.raw : null;

    if (!sport || !home_team || !away_team || !start_time_in) {
      return NextResponse.json(
        { error: "sport, home_team, away_team, and start_time are required" },
        { status: 400 },
      );
    }

    // If no provider_event_id, make a stable manual id (still unique)
    const provider_event_id = provider_event_id_in || `manual_${Date.now()}`;

    // Optional enrichment (only if provider_event_id seems real and API-Sports is available)
    let enriched: Enriched = null;

    const canEnrich =
      !!provider_event_id_in &&
      !provider_event_id_in.startsWith("mock_") &&
      !provider_event_id_in.startsWith("manual_") &&
      isApiSportsAvailable();

    if (canEnrich) {
      try {
        const apiResult = await fetchEvent(provider_event_id_in!, sport);
        if (apiResult) {
          enriched = {
            status: apiResult.status,
            score: isNonEmptyObject(apiResult.score) ? apiResult.score : {},
            raw: apiResult.raw ?? null,
            league: apiResult.league || league_in,
            start_time: apiResult.start_time || start_time_in,
            end_time: apiResult.end_time || end_time_in,
          };
        }
      } catch (e: any) {
        console.error(
          "create-event enrichment error (continuing with basic data):",
          e?.message,
        );
      }
    }

    const supabase = supabaseServer();

    // ---------------------------------------------------------------------
    // ✅ GET-OR-CREATE (avoid duplicate key on provider_event_id)
    // ---------------------------------------------------------------------

    // 1) Try to find existing row
    const { data: existing, error: findErr } = await supabase
      .from("sport_events")
      .select("*")
      .eq("provider_event_id", provider_event_id)
      .limit(1)
      .maybeSingle();

    // If the select fails for some reason, still continue to insert attempt (fallback)
    if (existing) {
      // Optional: update some fields if we got better info (non-breaking)
      // Only update if enrichment exists or we’re missing data in DB.
      const patch: any = {};

      if (enriched?.league && !existing.league) patch.league = enriched.league;
      if (enriched?.start_time && existing.start_time !== enriched.start_time) patch.start_time = enriched.start_time;
      if (enriched?.end_time && (!existing.end_time || existing.end_time !== enriched.end_time)) patch.end_time = enriched.end_time;

      if (enriched?.status && existing.status !== enriched.status) patch.status = enriched.status;
      if (enriched?.score && isNonEmptyObject(enriched.score)) patch.score = enriched.score;
      if (raw_in || enriched?.raw) {
        const merged = { ...(existing.raw || {}), ...(raw_in || {}), ...((enriched?.raw as any) || {}) };
        patch.raw = merged;
      }
      if (Object.keys(patch).length) {
        patch.last_update = new Date().toISOString();
        await supabase
          .from("sport_events")
          .update(patch)
          .eq("id", existing.id);
      }

      return NextResponse.json({ ok: true, event: existing, reused: true });
    }

    // 2) Insert new row
    const insertPayload = {
      provider,
      provider_event_id,
      sport,
      league: enriched?.league ?? league_in,
      home_team,
      away_team,
      start_time: enriched?.start_time ?? start_time_in,
      end_time: enriched?.end_time ?? end_time_in,
      status: enriched?.status ?? "scheduled",
      score: enriched?.score ?? {},
      raw: (raw_in || enriched?.raw)
  ? { ...(raw_in || {}), ...((enriched?.raw ?? body.raw as any) || {}) }
  : null,
      last_update: enriched ? new Date().toISOString() : null,
    };

    const { data: created, error: insErr } = await supabase
      .from("sport_events")
      .insert(insertPayload)
      .select("*")
      .single();

    // 3) If insert hit duplicate (race), re-select and return it
    if (insErr) {
      // Postgres unique violation
      if ((insErr as any)?.code === "23505") {
        const { data: again } = await supabase
          .from("sport_events")
          .select("*")
          .eq("provider_event_id", provider_event_id)
          .limit(1)
          .maybeSingle();

        if (again) {
          return NextResponse.json({ ok: true, event: again, reused: true });
        }
      }

      console.error("create-event insert error:", insErr, "findErr:", findErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, event: created, reused: false });
  } catch (e: any) {
    console.error("sports/create-event crash:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 },
    );
  }
}