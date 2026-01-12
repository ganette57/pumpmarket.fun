"use client";

import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { useMemo } from "react";
import idlJson from "@/idl/funmarket_pump.json";
import { PROGRAM_ID } from "@/utils/solana";

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;

    const provider = new AnchorProvider(connection, wallet, {
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
  }, [connection, wallet]);
}