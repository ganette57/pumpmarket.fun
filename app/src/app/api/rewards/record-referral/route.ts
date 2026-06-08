import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Records a referrer→referred relationship. Idempotent. Awards the
// referral_signup bonus on first insert. Accepts either a full referrer
// wallet address or a referral code (resolved via fun_points_accounts).
export async function POST(req: Request) {
  try {
    const { referrer, referred, referrerCode } = await req.json().catch(() => ({}));
    const referredW = String(referred || "").trim();
    if (!referredW) {
      return NextResponse.json({ error: "Missing referred" }, { status: 400 });
    }

    const supa = supabaseServer();

    let referrerW = String(referrer || "").trim();
    if (!referrerW && referrerCode) {
      const code = String(referrerCode || "").trim().toUpperCase();
      // Try stored code first
      const { data: byCode } = await supa
        .from("fun_points_accounts")
        .select("wallet")
        .eq("referral_code", code)
        .maybeSingle();
      if (byCode?.wallet) referrerW = byCode.wallet;
    }

    if (!referrerW) {
      return NextResponse.json({ ok: false, created: false, reason: "no_referrer" });
    }
    if (referrerW === referredW) {
      return NextResponse.json({ ok: false, created: false, reason: "self_referral" });
    }

    const { data, error } = await supa.rpc("fp_record_referral", {
      referrer_in: referrerW,
      referred_in: referredW,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, created: !!data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
