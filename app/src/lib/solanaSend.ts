import { Transaction } from "@solana/web3.js";
import type { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

type SendSignedTxArgs = {
    connection: Connection;
    tx: Transaction;
    signTx: (tx: Transaction) => Promise<Transaction>;
    feePayer: PublicKey;
    commitment?: "processed" | "confirmed" | "finalized";
    beforeSign?: (tx: Transaction) => void | Promise<void>; // optional hook (ex: partialSign)
  };

function getSigFromSignedTx(signed: Transaction): string | null {
  // For legacy Transaction: signatures = [{ publicKey, signature: Uint8Array | null }]
  const sigBytes = signed.signatures?.[0]?.signature;
  if (sigBytes && sigBytes instanceof Uint8Array) return bs58.encode(sigBytes);
  // Sometimes Transaction has .signature (Uint8Array | null)
  const s = (signed as any)?.signature;
  if (s && s instanceof Uint8Array) return bs58.encode(s);
  return null;
}

let signingInProgress = false;

export async function sendSignedTx({
  connection,
  tx,
  signTx,
  feePayer,
  commitment = "confirmed",
  beforeSign,
}: SendSignedTxArgs): Promise<string> {
  if (!feePayer) throw new Error("Missing feePayer");

  if (signingInProgress) {
    throw new Error("Signature already in progress");
  }

  signingInProgress = true;

  try {
    const latest = await connection.getLatestBlockhash(commitment);

    // Keep original behavior: set fee payer + blockhash on the tx before signing
    tx.feePayer = feePayer;
    tx.recentBlockhash = latest.blockhash;
    
    if (beforeSign) await beforeSign(tx);
    
    // Yield to event loop → helps Phantom popup rendering
    await new Promise((r) => setTimeout(r, 0));
    
    const signed = await signTx(tx);

    let txSig: string | null = null;

    try {
      txSig = await connection.sendRawTransaction(
        signed.serialize(),
        {
          skipPreflight: false,
          maxRetries: 3,
        }
      );
    } catch (e: any) {
      const msg = String(e?.message || "").toLowerCase();

      if (!msg.includes("already been processed")) throw e;

      txSig = getSigFromSignedTx(signed);
      if (!txSig) throw e;
    }

    await connection.confirmTransaction(
      {
        signature: txSig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      commitment
    );

    return txSig;
  } finally {
    signingInProgress = false;
  }
}