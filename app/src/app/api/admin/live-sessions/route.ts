import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminRequest } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

const SESSION_COLS =
  "id,created_at,title,market_address,host_wallet,stream_url,status,thumbnail_url," +
  "started_at,lock_at,end_at,ended_at,disabled_at,disabled_by,disable_reason";

function supabaseUrl() {
  const v = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("Missing env: SUPABASE_URL");
  return v;
}

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// GET /api/admin/live-sessions — all live sessions for the Live Operations
// dashboard. Admin-only. Returns newest first; the client groups by status.
export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = createClient(
    supabaseUrl(),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  try {
    const { data, error } = await supabase
      .from("live_sessions")
      .select(SESSION_COLS)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    return NextResponse.json(
      { ok: true, sessions: data || [] },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load live sessions" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
