import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ADMIN_PUBKEY = process.env.NEXT_PUBLIC_FUNMARKET_ADMIN_PUBKEY || "2FuGyidfE3N1tAf6vWFFystFcEVRp4WydHTmFr71pA9Y";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { market_address, action, reason, admin_wallet } = body;

    if (!market_address) {
      return NextResponse.json({ error: "market_address required" }, { status: 400 });
    }

    if (!action || !["block", "unblock"].includes(action)) {
      return NextResponse.json({ error: "action must be 'block' or 'unblock'" }, { status: 400 });
    }

    if (admin_wallet && admin_wallet !== ADMIN_PUBKEY) {
      return NextResponse.json({ error: "Unauthorized wallet" }, { status: 403 });
    }

    const { data: market, error: fetchError } = await supabaseAdmin
      .from("markets")
      .select("market_address, is_blocked, resolution_status")
      .eq("market_address", market_address)
      .single();

    if (fetchError || !market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    if (action === "block" && ["finalized", "cancelled"].includes(market.resolution_status)) {
      return NextResponse.json(
        { error: "Cannot block a finalized or cancelled market" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    if (action === "block") {
      const { error: updateError } = await supabaseAdmin
        .from("markets")
        .update({
          is_blocked: true,
          blocked_reason: reason || "Blocked by admin",
          blocked_at: nowIso,
          blocked_by: admin_wallet || ADMIN_PUBKEY,
        })
        .eq("market_address", market_address);

      if (updateError) {
        console.error("Block update error:", updateError);
        return NextResponse.json({ error: "Failed to block market" }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        action: "blocked",
        market_address,
        blocked_at: nowIso,
      });
    } else {
      const { error: updateError } = await supabaseAdmin
        .from("markets")
        .update({
          is_blocked: false,
          blocked_reason: null,
          blocked_at: null,
          blocked_by: null,
        })
        .eq("market_address", market_address);

      if (updateError) {
        console.error("Unblock update error:", updateError);
        return NextResponse.json({ error: "Failed to unblock market" }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        action: "unblocked",
        market_address,
      });
    }
  } catch (e: any) {
    console.error("Block API error:", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const market_address = searchParams.get("market_address");

  if (!market_address) {
    return NextResponse.json({ error: "market_address required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("markets")
    .select("market_address, is_blocked, blocked_reason, blocked_at, blocked_by")
    .eq("market_address", market_address)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  return NextResponse.json({
    market_address: data.market_address,
    is_blocked: !!data.is_blocked,
    blocked_reason: data.blocked_reason,
    blocked_at: data.blocked_at,
    blocked_by: data.blocked_by,
  });
}
