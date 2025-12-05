import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { useMemo } from 'react';
import { PublicKey } from '@solana/web3.js';
import idl from '@/idl/funmarket_pump.json';

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const program = useMemo(() => {
    if (!wallet) return null;

    const provider = new AnchorProvider(
      connection,
      wallet,
      { commitment: 'confirmed' }
    );

    // Extract programId from IDL (Anchor 0.32 format)
    const programId = new PublicKey((idl as any).address);

    return new Program(idl as Idl, programId, provider);
  }, [connection, wallet]);

  return program;
}
