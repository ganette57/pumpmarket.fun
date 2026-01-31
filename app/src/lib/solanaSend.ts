import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

type SendSignedTxArgs = {
  connection: Connection;
  tx: Transaction;
  signTx: (tx: Transaction) => Promise<Transaction>;
  feePayer: PublicKey;
  commitment?: "processed" | "confirmed" | "finalized";
  beforeSign?: (tx: Transaction) => void | Promise<void>;
};

function getSigFromSignedTx(signed: Transaction): string | null {
  const sigBytes = signed.signatures?.[0]?.signature;
  if (sigBytes && sigBytes instanceof Uint8Array) return bs58.encode(sigBytes);
  const s = (signed as any)?.signature;
  if (s && s instanceof Uint8Array) return bs58.encode(s);
  return null;
}

async function confirmWithPolling(
  connection: Connection,
  signature: string,
  timeoutMs = 15_000,
  desired: "processed" | "confirmed" | "finalized" = "processed"
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
    const s = st?.value?.[0];

    if (s?.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`);

    const cs = s?.confirmationStatus;

    if (desired === "processed") {
      if (cs === "processed" || cs === "confirmed" || cs === "finalized") return;
    } else if (desired === "confirmed") {
      if (cs === "confirmed" || cs === "finalized") return;
    } else {
      if (cs === "finalized") return;
    }

    await new Promise((r) => setTimeout(r, 500));
  }
  // timeout => don't hard fail (devnet/rpc can be slow). UI will refresh anyway.
}

export async function sendSignedTx({
  connection,
  tx,
  signTx,
  feePayer,
  commitment = "processed", // ✅ faster default for devnet UX
  beforeSign,
}: SendSignedTxArgs): Promise<string> {
  if (!feePayer) throw new Error("Missing feePayer");

  // ✅ Always use processed for blockhash fetch (faster)
  const latest = await connection.getLatestBlockhash("processed");
  tx.feePayer = feePayer;
  tx.recentBlockhash = latest.blockhash;

  if (beforeSign) await beforeSign(tx);

  const signed = await signTx(tx);

  let txSig: string | null = null;

  try {
    txSig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true, // ✅ devnet speed
      maxRetries: 2,
    });
  } catch (e: any) {
    const msg = String(e?.message || "").toLowerCase();
    if (!msg.includes("already been processed")) throw e;

    txSig = getSigFromSignedTx(signed);
    if (!txSig) throw e;
  }

  // ✅ Don't block 40s+ on confirmTransaction
  await confirmWithPolling(connection, txSig, 15_000, commitment);

  return txSig;
}