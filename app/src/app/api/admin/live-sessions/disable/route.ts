import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminWalletFromRequest } from "@/lib/admin";
import { parseStream } from "@/lib/streamProviders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

const SESSION_COLS =
  "id,created_at,title,market_address,host_wallet,stream_url,status,thumbnail_url," +
  "started_at,lock_at,end_at,ended_at,disabled_at,disabled_by,disable_reason";

// Allowed disable reasons (Part 5). Free-form text is rejected to keep the
// audit trail clean.
const VALID_REASONS = new Set([
  "dmca",
  "copyright",
  "creator_request",
  "platform_request",
  "terms_violation",
  "manual",
]);

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

// POST /api/admin/live-sessions/disable
// Body: { session_id, reason }
// Marks a session as disabled for compliance/moderation (Part 4 & 5).
// Does NOT delete the stream, the URL, or any data — it only flips the status
// and records the audit trail (disabled_at / disabled_by / disable_reason).
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
  const reason = String(body?.reason || "").trim().toLowerCase();
  const addToBlocklist = body?.add_to_blocklist === true;

  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!VALID_REASONS.has(reason)) {
    return NextResponse.json(
      { error: "Invalid disable reason" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = createClient(supabaseUrl(), serviceKey(), {
    auth: { persistSession: false },
  });

  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("live_sessions")
      .select("id,status,stream_url")
      .eq("id", sessionId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      return NextResponse.json(
        { error: "Live session not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const { data, error } = await supabase
      .from("live_sessions")
      .update({
        status: "disabled",
        disabled_at: new Date().toISOString(),
        disabled_by: adminWallet,
        disable_reason: reason,
      })
      .eq("id", sessionId)
      .select(SESSION_COLS)
      .maybeSingle();

    if (error) throw error;

    // Optionally add this specific stream (video id / channel) to the
    // compliance block-list so it can't be re-used to create a new session.
    // Blocks only the specific identifier — never the whole provider.
    let blocklisted = false;
    if (addToBlocklist) {
      const parsed = parseStream(String((existing as any).stream_url || ""));
      if (parsed.provider && (parsed.videoId || parsed.channel)) {
        const filter = parsed.videoId
          ? { col: "provider_video_id", val: parsed.videoId }
          : { col: "provider_channel", val: parsed.channel as string };

        // Avoid duplicate rows for the same identifier.
        const { data: dup } = await supabase
          .from("blocked_streams")
          .select("id")
          .eq("provider", parsed.provider)
          .eq(filter.col, filter.val)
          .limit(1);

        if (!dup || dup.length === 0) {
          const { error: blockErr } = await supabase.from("blocked_streams").insert({
            provider: parsed.provider,
            provider_video_id: parsed.videoId,
            provider_channel: parsed.videoId ? null : parsed.channel,
            reason,
          });
          if (!blockErr) blocklisted = true;
        } else {
          blocklisted = true; // already present
        }
      }
    }

    return NextResponse.json(
      { ok: true, session: data, blocklisted },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to disable live session" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
