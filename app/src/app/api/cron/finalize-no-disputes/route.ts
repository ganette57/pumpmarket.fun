import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Idl, utils } from "@coral-xyz/anchor";
import idl from "@/idl/funmarket_pump.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function assertCronAuth(req: Request) {
  const secret = env("CRON_SECRET");
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) throw new Error("Unauthorized");
}

function supabaseAdmin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

function getSigner(): Keypair {
  // option 1: base58 secret key
  const b58 = env("CRON_SIGNER_SECRET_KEY_B58");
  return Keypair.fromSecretKey(utils.bytes.bs58.decode(b58));
}

function getProgram() {
  const rpc = env("SOLANA_RPC"); // server-side RPC
  const signer = getSigner();

  const connection = new Connection(rpc, "confirmed");
  const wallet = {
    publicKey: signer.publicKey,
    signTransaction: async (tx: any) => {
      tx.partialSign(signer);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach((t) => t.partialSign(signer));
      return txs;
    },
  } as any;

  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new (Program as any)(idl as Idl, programId, provider);  return { program, connection };
}

export async function GET(req: Request) {
  try {
    assertCronAuth(req);

    const supabase = supabaseAdmin();
    const now = new Date().toISOString();

    // 1) candidates: DB says proposed AND contest window closed
    const { data: rows, error } = await supabase
      .from("markets")
      .select("market_address, proposed_winning_outcome, contest_deadline, contest_count, resolved, cancelled, resolution_status")
      .eq("resolution_status", "proposed")
      .eq("resolved", false)
      .eq("cancelled", false)
      .lte("contest_deadline", now)
      .limit(50);

    if (error) throw error;

    const { program } = getProgram();

    const results: any[] = [];

    for (const m of rows || []) {
      const marketAddr = String(m.market_address);

      try {
        // 2) verify on-chain state (0 disputes + proposed + deadline passed)
        const marketPk = new PublicKey(marketAddr);
        const acct: any = await (program as any).account.market.fetch(marketPk);

        const statusObj = acct?.status ?? acct?.marketStatus ?? acct?.market_status;
        const status = typeof statusObj === "string" ? statusObj.toLowerCase() : Object.keys(statusObj || {})[0]?.toLowerCase();
        const disputeCount = Number(acct?.disputeCount?.toString?.() ?? acct?.dispute_count?.toString?.() ?? 0);
        const contestDeadlineSec = Number(acct?.contestDeadline?.toString?.() ?? acct?.contest_deadline?.toString?.() ?? 0);

        const deadlinePassed = contestDeadlineSec > 0 && Date.now() >= contestDeadlineSec * 1000;

        if (status !== "proposed" || disputeCount !== 0 || !deadlinePassed) {
          results.push({ market: marketAddr, ok: false, skip: true, status, disputeCount, deadlinePassed });
          continue;
        }

        // 3) finalizeIfNoDisputes (any signer)
        const txSig = await (program as any).methods
          .finalizeIfNoDisputes()
          .accounts({ market: marketPk, user: (program as any).provider.wallet.publicKey })
          .rpc();

        // 4) DB commit
        const wo = Number(m.proposed_winning_outcome ?? 0);

        const { error: updErr } = await supabase
          .from("markets")
          .update({
            resolved: true,
            cancelled: false,
            resolution_status: "finalized",
            winning_outcome: wo,
            resolved_at: new Date().toISOString(),
            resolve_tx: txSig,
          })
          .eq("market_address", marketAddr);

        if (updErr) throw updErr;

        results.push({ market: marketAddr, ok: true, txSig });
      } catch (e: any) {
        results.push({ market: marketAddr, ok: false, error: String(e?.message || e) });
      }
    }

    return NextResponse.json({ ok: true, count: results.length, results });
} catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}