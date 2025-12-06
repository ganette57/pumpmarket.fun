import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { useMemo } from 'react';
import idl from '@/idl/funmarket_pump.json';

const PROGRAM_ID = new PublicKey("BV6q3zDwjaXdcn3DmqroHbeNuTDxtrpyYXvGNeYec6Wy");

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

    // Force PROGRAM_ID explicitly for Anchor 0.29
    return new Program(idl as Idl, PROGRAM_ID, provider);
  }, [connection, wallet]);

  return program;
}
