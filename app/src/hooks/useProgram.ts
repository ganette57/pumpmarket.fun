import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { useMemo } from 'react';
import idl from '@/idl/funmarket_pump.json';

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    // Anchor 0.30+ lit l'address directement dans l'IDL
    return new Program(idl, provider);
  }, [connection, wallet]);
}
