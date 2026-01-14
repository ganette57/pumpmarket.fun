import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import idl from "@/idl/funmarket_pump.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ----------------------------- small helpers ----------------------------- */

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

// ✅ bs58 decode safe (works CJS/ESM on Vercel)
function bs58Decode(str: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("bs58");
  const bs58 = mod?.decode ? mod : mod?.default;
  if (!bs58?.decode) throw new Error("bs58 decode not available");
  return bs58.decode(str.trim());
}

function getSigner(): Keypair {
  const b58 = env("CRON_SIGNER_SECRET_KEY_B58");
  const decoded = bs58Decode(b58);
  if (!decoded || decoded.length !== 64) {
    throw new Error(`CRON_SIGNER_SECRET_KEY_B58 must decode to 64 bytes, got ${decoded?.length}`);
  }
  return Keypair.fromSecretKey(decoded);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ✅ HTTP polling confirm (no websocket / signatureSubscribe)
async function confirmByPolling(connection: Connection, signature: string, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const s = st.value[0];

    if (s?.err) throw new Error(`Tx failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return;

    await sleep(1200);
  }
  throw new Error(`Timeout confirming tx ${signature}`);
}

function getProgram() {
  const rpc = env("SOLANA_RPC");
  const programId = new PublicKey(env("NEXT_PUBLIC_PROGRAM_ID"));
  const signer = getSigner();

  const connection = new Connection(rpc, { commitment: "confirmed" });

  const wallet = {
    publicKey: signer.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(signer);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      txs.forEach((t) => t.partialSign(signer));
      return txs;
    },
  } as any;

  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const ProgramAny: any = Program;

  // ensure idl has address if using 2-arg Program ctor
  const pid = programId;
  const idlAny: any = idl;
  if (!idlAny.address) idlAny.address = pid.toBase58();

  const program =
    ProgramAny.length >= 3
      ? new ProgramAny(idlAny as Idl, pid, provider)
      : new ProgramAny(idlAny as Idl, provider);

  return { program, connection, signer, programId: pid };
}

function bnToNum(x: any): number {
  if (x == null) return 0;
  if (typeof x === "number") return Math.floor(x);
  if (typeof x?.toNumber === "function") return x.toNumber();
  return Math.floor(Number(x?.toString?.() ?? x) || 0);
}

function parseStatus(statusObj: any): "open" | "proposed" | "finalized" | "cancelled" | "unknown" {
  if (!statusObj) return "unknown";
  if (typeof statusObj === "string") {
    const s = statusObj.toLowerCase();
    if (s === "open" || s === "proposed" || s === "finalized" || s === "cancelled") return s;
    return "unknown";
  }
  const k = Object.keys(statusObj || {})[0]?.toLowerCase();
  if (k === "open" || k === "proposed" || k === "finalized" || k === "cancelled") return k;
  return "unknown";
}

/* -------------------------------------------------------------------------- */
/* Cron                                                                        */
/* -------------------------------------------------------------------------- */

export async function GET(req: Request) {
  let step = "init";

  try {
    step = "auth";
    assertCronAuth(req);

    step = "supabase";
    const supabase = supabaseAdmin();

    // 48h cutoff based on DB end_date to select candidates
    step = "select_candidates";
    const cutoffIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    const { data: rows, error } = await supabase
      .from("markets")
      .select("market_address, end_date, resolved, cancelled, resolution_status")
      .eq("resolution_status", "open")
      .eq("resolved", false)
      .eq("cancelled", false)
      .lte("end_date", cutoffIso)
      .limit(50);

    if (error) throw error;
    if (!rows?.length) return NextResponse.json({ ok: true, step: "done", count: 0, results: [] });

    step = "anchor_init";
    const { program, connection, signer, programId } = getProgram();

    const results: any[] = [];

    step = "loop";
    for (const m of rows) {
      const marketAddr = String((m as any).market_address || "");
      if (!marketAddr) continue;

      try {
        const marketPk = new PublicKey(marketAddr);

        // ✅ Guard: skip markets owned by another program (old SC, etc.)
        step = `owner_check:${marketAddr}`;
        const info = await connection.getAccountInfo(marketPk);
        if (!info) {
          results.push({ market: marketAddr, ok: false, skip: true, reason: "missing_account" });
          continue;
        }
        const owner = info.owner.toBase58();
        const expected = programId.toBase58();
        if (owner !== expected) {
          results.push({ market: marketAddr, ok: false, skip: true, reason: "wrong_program_owner", owner, expected });
          continue;
        }

        // Fetch on-chain market (source of truth)
        step = `fetch_market:${marketAddr}`;
        const acct: any = await (program as any).account.market.fetch(marketPk);

        const status = parseStatus(acct?.status ?? acct?.marketStatus ?? acct?.market_status);
        const resolved = !!acct?.resolved;
        const cancelled = !!acct?.cancelled;

        // on-chain end time guard (resolutionTime is i64 seconds)
        const nowSec = Math.floor(Date.now() / 1000);
        const resolutionTimeSec = bnToNum(acct?.resolutionTime ?? acct?.resolution_time);

        // If it hasn't ended on-chain, skip
        if (resolutionTimeSec && nowSec < resolutionTimeSec) {
          results.push({
            market: marketAddr,
            ok: false,
            skip: true,
            reason: "not_ended_onchain",
            endsInSec: resolutionTimeSec - nowSec,
          });
          continue;
        }

        // Must still be OPEN and not already proposed/cancelled/resolved
        if (status !== "open" || resolved || cancelled) {
          results.push({
            market: marketAddr,
            ok: false,
            skip: true,
            reason: "not_open",
            status,
            resolved,
            cancelled,
          });
          continue;
        }

        // ✅ On-chain cancel: cancelIfNoProposal(market, user)
        step = `build_tx:${marketAddr}`;
        const tx = await (program as any).methods
          .cancelIfNoProposal()
          .accounts({
            market: marketPk,
            user: signer.publicKey,
          })
          .transaction();

        tx.feePayer = signer.publicKey;
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.sign(signer);

        step = `send_tx:${marketAddr}`;
        const raw = tx.serialize();
        const txSig = await connection.sendRawTransaction(raw, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });

        step = `confirm_tx:${marketAddr}`;
        await confirmByPolling(connection, txSig);

        // ✅ DB update (mark cancelled so refunds are claimable in UI)
        step = `db_update:${marketAddr}`;
        const { error: updErr } = await supabase
          .from("markets")
          .update({
            cancelled: true,
            resolved: false,
            resolution_status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancel_reason: "no_proposal_48h",
            cancel_tx: txSig,
          })
          .eq("market_address", marketAddr);

        if (updErr) throw updErr;

        results.push({ market: marketAddr, ok: true, txSig });
      } catch (e: any) {
        results.push({ market: marketAddr, ok: false, step, error: String(e?.message || e) });
      }
    }

    return NextResponse.json({ ok: true, step: "done", count: results.length, results });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, step, error: msg }, { status });
  }
}