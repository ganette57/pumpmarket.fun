// src/lib/sportEvents.ts
// Client-side helpers for sport_events table (read-only via anon key)

import { supabase } from "@/lib/supabaseClient";

export type SportEvent = {
  id: string;
  provider: string;
  provider_event_id: string;
  sport: string;
  league: string | null;
  home_team: string | null;
  away_team: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  score: Record<string, unknown>;
  last_update: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
};

export async function getSportEvent(id: string): Promise<SportEvent | null> {
  if (!id) return null;
  const { data, error } = await supabase
    .from("sport_events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getSportEvent error:", error);
    return null;
  }
  return data as SportEvent | null;
}

/** Client-side read-only refresh (no token = just returns cached row) */
export async function refreshSportEvent(sportEventId: string): Promise<SportEvent | null> {
  const res = await fetch("/api/sports/refresh-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sport_event_id: sportEventId }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return (json.event as SportEvent) ?? null;
}

/** Create sport event via server endpoint (bypasses RLS) */
export async function createSportEventServer(row: {
  provider: string;
  provider_event_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  start_time: string;
  end_time?: string;
  league?: string;
}): Promise<SportEvent> {
  const res = await fetch("/api/sports/create-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || "Failed to create sport event");
  }
  const json = await res.json();
  return json.event as SportEvent;
}
