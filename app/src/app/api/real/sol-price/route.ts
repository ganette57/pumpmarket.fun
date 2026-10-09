import { NextResponse } from "next/server";
import { getSolUsdPrice } from "@/lib/solPrice";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ sol_usd: await getSolUsdPrice() });
}
