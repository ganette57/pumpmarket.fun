import { NextResponse } from "next/server";
import { getFlashCryptoLivePrice } from "@/lib/flashCrypto/priceSource";
import { resolveFlashCryptoMajorSelection } from "@/lib/flashCrypto/majors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sourceType = String(url.searchParams.get("source_type") || "").trim().toLowerCase();
    const mint = String(url.searchParams.get("mint") || "").trim();
    const pair = String(url.searchParams.get("pair") || "").trim();
    const majorSymbol = String(url.searchParams.get("major_symbol") || "").trim();
    const majorSelection =
      sourceType === "major" || pair || majorSymbol
        ? resolveFlashCryptoMajorSelection({ raw: mint || pair || majorSymbol, pair, symbol: majorSymbol })
        : null;

    const resolvedInput = majorSelection?.pair || mint || pair;
    if (!resolvedInput) {
      return NextResponse.json({ error: "mint (or pair) param required" }, { status: 400 });
    }
    const isMemeRequest = sourceType !== "major" && !majorSelection;

    if (isMemeRequest) {
      console.log("[flash-meme] live price request ...", {
        tokenMint: resolvedInput,
        sourceType: sourceType || "pump_fun",
      });
    }

    const snap = await getFlashCryptoLivePrice(resolvedInput, {
      sourceType: sourceType === "major" ? "major" : undefined,
      majorSymbol: majorSelection?.symbol || majorSymbol || null,
      majorPair: majorSelection?.pair || pair || null,
      preferRealtimePump: isMemeRequest,
    });

    if (isMemeRequest) {
      console.log(`[flash-meme] provider selected = ${snap.provider}`);
      console.log("[flash-meme] live price returned = ...", {
        tokenMint: snap.mint,
        sourceType: snap.sourceType || "pump_fun",
        provider: snap.provider,
        source: snap.source,
        price: snap.price,
      });
    }

    return NextResponse.json(
      {
        mint: snap.mint,
        price: snap.price,
        symbol: snap.symbol,
        name: snap.name,
        provider: snap.provider,
        source: snap.source,
        source_type: snap.sourceType || null,
        major_symbol: snap.majorSymbol || null,
        major_pair: snap.majorPair || null,
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
