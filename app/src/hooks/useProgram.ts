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

    const idl = {
      ...(idlJson as any),
      address: PROGRAM_ID.toBase58(),
    } as Idl;

    return new Program(idl, provider);
  }, [connection, wallet]);
}