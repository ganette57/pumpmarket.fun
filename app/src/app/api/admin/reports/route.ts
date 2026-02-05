// app/api/admin/reports/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "pending"; // pending, reviewed, dismissed, all
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));

    let query = supabase
      .from("reports")
      .select(`
        id,
        created_at,
        market_address,
        reporter_address,
        reason,
        details,
        status,
        reviewed_at,
        reviewed_by
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data: reports, error } = await query;

    if (error) {
      console.error("Reports fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get market questions for context
    const marketAddresses = Array.from(new Set((reports || []).map((r) => r.market_address)));    
    let marketMap: Record<string, { question: string; is_blocked: boolean }> = {};
    
    if (marketAddresses.length > 0) {
      const { data: markets } = await supabase
        .from("markets")
        .select("market_address, question, is_blocked")
        .in("market_address", marketAddresses);

      if (markets) {
        for (const m of markets) {
          marketMap[m.market_address] = {
            question: m.question || "(Untitled)",
            is_blocked: !!m.is_blocked,
          };
        }
      }
    }

    // Enrich reports with market info
    const enrichedReports = (reports || []).map((r) => ({
      ...r,
      market_question: marketMap[r.market_address]?.question || "(Unknown)",
      market_is_blocked: marketMap[r.market_address]?.is_blocked || false,
    }));

    // Count by status
    const { count: pendingCount } = await supabase
      .from("reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    const { count: totalCount } = await supabase
      .from("reports")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      ok: true,
      reports: enrichedReports,
      counts: {
        pending: pendingCount || 0,
        total: totalCount || 0,
      },
    });

  } catch (e: any) {
    console.error("Reports API error:", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

// Mark report as reviewed/dismissed
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const report_id = String(body.report_id || "").trim();
    const action = String(body.action || "").trim(); // "reviewed" or "dismissed"
    const admin_wallet = body.admin_wallet ? String(body.admin_wallet).trim() : null;

    if (!report_id) {
      return NextResponse.json({ error: "report_id is required" }, { status: 400 });
    }

    if (!["reviewed", "dismissed"].includes(action)) {
      return NextResponse.json({ error: "action must be 'reviewed' or 'dismissed'" }, { status: 400 });
    }

    const { error } = await supabase
      .from("reports")
      .update({
        status: action,
        reviewed_at: new Date().toISOString(),
        reviewed_by: admin_wallet,
      })
      .eq("id", report_id);

    if (error) {
      console.error("Report update error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      action,
      report_id,
    });

  } catch (e: any) {
    console.error("Report update API error:", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}