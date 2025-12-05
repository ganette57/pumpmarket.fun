import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { useMemo } from 'react';
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

    // With Anchor 0.32, the IDL contains the 'address' field
    // So we can just pass idl and provider (no need for programId parameter)
    return new Program(idl as Idl, provider);
  }, [connection, wallet]);

  return program;
}
