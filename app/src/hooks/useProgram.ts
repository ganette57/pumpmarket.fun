import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { useMemo, useEffect, useState } from 'react';
import idl from '@/idl/funmarket_pump.json';

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [phantomWallet, setPhantomWallet] = useState<any>(null);

  // Check if we should use Phantom wallet directly
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).solana) {
      const phantom = (window as any).solana;
      if (phantom.publicKey) {
        // Create a compatible wallet object for Phantom
        const phantomAdapter = {
          publicKey: phantom.publicKey,
          signTransaction: phantom.signTransaction.bind(phantom),
          signAllTransactions: phantom.signAllTransactions.bind(phantom),
        };
        setPhantomWallet(phantomAdapter);

        console.log('🔍 useProgram wallet check:');
        console.log('  Adapter wallet:', wallet?.publicKey?.toBase58());
        console.log('  Phantom wallet:', phantom.publicKey.toBase58());

        if (wallet?.publicKey && wallet.publicKey.toBase58() !== phantom.publicKey.toBase58()) {
          console.warn('⚠️ useProgram: Using Phantom wallet instead of adapter wallet');
        }
      }
    }
  }, [wallet]);

  return useMemo(() => {
    // Prefer Phantom wallet if available, otherwise use adapter wallet
    const activeWallet = phantomWallet || wallet;

    if (!activeWallet) return null;

    const provider = new AnchorProvider(connection, activeWallet, { commitment: 'confirmed' });
    // Force cast to Idl to avoid version compatibility issues
    return new Program(idl as unknown as Idl, provider);
  }, [connection, wallet, phantomWallet]);
}