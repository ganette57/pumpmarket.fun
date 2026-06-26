import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminWalletFromRequest } from "@/lib/admin";

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

function serviceKey() {
  const v = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!v) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  return v;
}

// POST /api/admin/live-sessions/restore
// Body: { session_id }
// Re-enables a session that was disabled by mistake. Sets the status back to
// "live" and keeps the disable audit columns (disabled_at / disabled_by /
// disable_reason) as a historical record. Does NOT delete any data and does
// NOT touch Host Controls or the StreamPlayer.
export async function POST(req: Request) {
  const adminWallet = await adminWalletFromRequest(req);
  if (!adminWallet) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sessionId = String(body?.session_id || "").trim();
  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = createClient(supabaseUrl(), serviceKey(), {
    auth: { persistSession: false },
  });

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("live_sessions")
      .select("id,status")
      .eq("id", sessionId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      return NextResponse.json(
        { error: "Live session not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    if (existing.status !== "disabled") {
      return NextResponse.json(
        { error: "Session is not disabled" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { data, error } = await supabase
      .from("live_sessions")
      .update({ status: "live" })
      .eq("id", sessionId)
      .select(SESSION_COLS)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json(
      { ok: true, session: data },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to restore live session" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
