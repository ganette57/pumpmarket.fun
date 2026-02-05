// app/api/markets/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VALID_REASONS = ["spam", "inappropriate", "scam", "misleading", "duplicate", "other"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const market_address = String(body.market_address || "").trim();
    const reporter_address = body.reporter_address ? String(body.reporter_address).trim() : null;
    const reason = String(body.reason || "").trim().toLowerCase();
    const details = body.details ? String(body.details).trim().slice(0, 1000) : null;

    // Validation
    if (!market_address) {
      return NextResponse.json({ error: "market_address is required" }, { status: 400 });
    }

    if (!reason || !VALID_REASONS.includes(reason)) {
      return NextResponse.json(
        { error: `Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Check market exists
    const { data: market, error: marketErr } = await supabase
      .from("markets")
      .select("market_address")
      .eq("market_address", market_address)
      .maybeSingle();

    if (marketErr || !market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    // Rate limit: max 3 reports per wallet per market
    if (reporter_address) {
      const { count, error: countErr } = await supabase
        .from("reports")
        .select("*", { count: "exact", head: true })
        .eq("market_address", market_address)
        .eq("reporter_address", reporter_address);

      if (!countErr && count && count >= 3) {
        return NextResponse.json(
          { error: "You have already reported this market multiple times" },
          { status: 429 }
        );
      }
    }

    // Insert report
    const { data, error } = await supabase
      .from("reports")
      .insert({
        market_address,
        reporter_address,
        reason,
        details,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Report insert error:", error);
      return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      report_id: data.id,
      message: "Report submitted successfully. Thank you for helping keep FunMarket safe.",
    });

  } catch (e: any) {
    console.error("Report API error:", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}