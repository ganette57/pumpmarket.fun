import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
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

// ✅ bs58 decode safe (works CJS/ESM on Vercel)
function bs58Decode(str: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("bs58");
  const bs58 = mod?.decode ? mod : mod?.default; // handle default export
  if (!bs58?.decode) throw new Error("bs58 decode not available");
  return bs58.decode(str.trim());
}

function getSigner(): Keypair {
  const b58 = env("CRON_SIGNER_SECRET_KEY_B58");
  const decoded = bs58Decode(b58);

  // Keypair secretKey must be 64 bytes
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

  // ✅ Anchor compat: some versions use new Program(idl, provider),
  // others use new Program(idl, programId, provider)
  const ProgramAny: any = Program;

  // ensure idl has an address when using the 2-arg constructor
  const pid = programId;
  const idlAny: any = idl;
  if (!idlAny.address) idlAny.address = pid.toBase58();

  const program =
    ProgramAny.length >= 3
      ? new ProgramAny(idlAny as Idl, pid, provider)
      : new ProgramAny(idlAny as Idl, provider);

  // ✅ return programId too (for owner guard)
  return { program, connection, signer, programId: pid };
}

export async function GET(req: Request) {
  let step = "init";

  try {
    step = "auth";
    assertCronAuth(req);

    step = "supabase";
    const supabase = supabaseAdmin();

    step = "select_candidates";
    const now = new Date().toISOString();
    const { data: rows, error } = await supabase
      .from("markets")
      .select("market_address, proposed_winning_outcome, contest_deadline, resolved, cancelled, resolution_status")
      .eq("resolution_status", "proposed")
      .eq("resolved", false)
      .eq("cancelled", false)
      .lte("contest_deadline", now)
      .limit(50);

    if (error) throw error;

    step = "anchor_init";
    const { program, connection, signer, programId } = getProgram();

    const results: any[] = [];

    step = "loop";
    for (const m of rows || []) {
      const marketAddr = String(m.market_address);

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

        step = `fetch_market:${marketAddr}`;
        const acct: any = await (program as any).account.market.fetch(marketPk);

        const statusObj = acct?.status ?? acct?.marketStatus ?? acct?.market_status;
        const status =
          typeof statusObj === "string"
            ? statusObj.toLowerCase()
            : Object.keys(statusObj || {})[0]?.toLowerCase();

        const disputeCount = Number(acct?.disputeCount?.toString?.() ?? acct?.dispute_count?.toString?.() ?? 0);

        const contestDeadlineSec = Number(acct?.contestDeadline?.toString?.() ?? acct?.contest_deadline?.toString?.() ?? 0);

        const deadlinePassed = contestDeadlineSec > 0 && Date.now() >= contestDeadlineSec * 1000;

        if (status !== "proposed" || disputeCount !== 0 || !deadlinePassed) {
          results.push({ market: marketAddr, ok: false, skip: true, status, disputeCount, deadlinePassed });
          continue;
        }

        step = `build_tx:${marketAddr}`;
        const tx = await (program as any).methods
          .finalizeIfNoDisputes()
          .accounts({ market: marketPk, user: signer.publicKey })
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

        step = `db_update:${marketAddr}`;
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