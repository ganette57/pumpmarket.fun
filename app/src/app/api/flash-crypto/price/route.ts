import { NextResponse } from "next/server";
import { getFlashCryptoLivePrice } from "@/lib/flashCrypto/priceSource";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mint = String(url.searchParams.get("mint") || "").trim();
    if (!mint) {
      return NextResponse.json({ error: "mint param required" }, { status: 400 });
    }

    const snap = await getFlashCryptoLivePrice(mint);

    return NextResponse.json(
      {
        mint: snap.mint,
        price: snap.price,
        symbol: snap.symbol,
        name: snap.name,
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
