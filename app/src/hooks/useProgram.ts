"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { useMemo } from "react";
import idlJson from "@/idl/funmarket_pump.json";
import { PROGRAM_ID } from "@/utils/solana";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";

/**
 * The Anchor program, bound to whichever FunMarket wallet is active.
 *
 * This used to read useAnchorWallet() from the Solana wallet adapter, so
 * Real trading only worked with a browser extension. It now takes its
 * signer from useFunMarketWallet(), which resolves to either the Privy
 * embedded wallet or an external one.
 *
 * Nothing below the provider changed: Anchor's Wallet interface is
 * exactly `publicKey` + `signTransaction` + `signAllTransactions`, both
 * implementations supply all three, and the program, the IDL, the account
 * derivation and the RPC are untouched.
 */
export function useProgram() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions } = useFunMarketWallet();

  return useMemo(() => {
    if (!publicKey || !signTransaction) return null;

    // signAllTransactions is optional on the wallet but required by
    // Anchor's interface. FunMarket never batches, so a sequential
    // fallback is honest rather than a silent throw — and both real
    // implementations provide the batched version anyway.
    const wallet = {
      publicKey,
      signTransaction,
      signAllTransactions:
        signAllTransactions ??
        (async <T,>(txs: T[]): Promise<T[]> => {
          const out: T[] = [];
          for (const tx of txs) out.push(await (signTransaction as any)(tx));
          return out;
        }),
    };

    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

    // ✅ Anchor versions differ on where they read programId (address / metadata.address)
    const idl = {
      ...(idlJson as any),
      address: PROGRAM_ID.toBase58(),
      metadata: {
        ...((idlJson as any)?.metadata ?? {}),
        address: PROGRAM_ID.toBase58(),
      },
    } as Idl;

    try {
      // ✅ Some versions: new Program(idl, provider)
      // ✅ Other versions: new Program(idl, programId, provider)
      const use3Args = (Program as any).length >= 3;

      return use3Args
        ? new (Program as any)(idl, PROGRAM_ID, provider)
        : new (Program as any)(idl, provider);
    } catch (e) {
      console.error("[useProgram] failed to init Program", e, {
        PROGRAM_ID: PROGRAM_ID.toBase58(),
      });
      return null;
    }
  }, [connection, publicKey, signTransaction, signAllTransactions]);
}
