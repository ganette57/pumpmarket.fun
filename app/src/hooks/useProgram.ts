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
    });

    // ✅ Force l'address dans l'IDL (important si tu changes de programId)
    const idl = {
      ...(idlJson as any),
      metadata: {
        ...((idlJson as any).metadata || {}),
        address: PROGRAM_ID.toBase58(),
      },
    } as unknown as Idl;

    // ✅ Signature compatible avec les versions d'Anchor qui crashent avec 3 args
    return new Program(idl, provider);
  }, [connection, wallet]);
}