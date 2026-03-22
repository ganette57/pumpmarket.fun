import { NextResponse } from "next/server";
import { getFlashCryptoGraduationSnapshot } from "@/lib/flashCrypto/graduationSource";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mint = String(url.searchParams.get("mint") || "").trim();
    if (!mint) {
      return NextResponse.json({ error: "mint param required" }, { status: 400 });
    }

    const snap = await getFlashCryptoGraduationSnapshot(mint);

    return NextResponse.json(
      {
        mint: snap.mint,
        symbol: snap.symbol,
        name: snap.name,
        imageUri: snap.imageUri,
        progressPct: snap.progressPct,
        didGraduate: snap.didGraduate,
        remainingToGraduate: snap.remainingToGraduate,
        provider: snap.provider,
        source: snap.source,
        timestamp: Date.now(),
      },
      {
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message || "Unknown error") },
      { status: 500 },
    );
  }
}
