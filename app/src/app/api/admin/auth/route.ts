import { NextResponse } from "next/server";
import { getAdminPassword, getAdminWallet, makeSessionToken } from "@/lib/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String(body?.wallet || "").trim();
    const password = String(body?.password || "").trim();

    const adminWallet = getAdminWallet();
    if (!adminWallet) return NextResponse.json({ error: "Missing NEXT_PUBLIC_ADMIN_WALLET" }, { status: 500 });

    if (!wallet) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
    if (wallet !== adminWallet) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

    const expectedPw = getAdminPassword();
    if (expectedPw && password !== expectedPw) {
      return NextResponse.json({ error: "Bad password" }, { status: 401 });
    }

    const token = makeSessionToken(wallet);

    const res = NextResponse.json({ ok: true });
    res.cookies.set("admin_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Auth error" }, { status: 500 });
  }
}