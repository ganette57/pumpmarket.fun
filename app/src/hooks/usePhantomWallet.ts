import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

/**
 * Hook to get the correct Phantom wallet publicKey
 * Prioritizes window.solana.publicKey if available and connected
 * Falls back to useWallet().publicKey
 */
export function usePhantomWallet() {
  const { publicKey: walletAdapterKey, connected, connect } = useWallet();
  const [resolvedPublicKey, setResolvedPublicKey] = useState<PublicKey | null>(null);

  useEffect(() => {
    if (!connected) {
      setResolvedPublicKey(null);
      return;
    }

    // Check if Phantom is available
    if (typeof window !== 'undefined' && (window as any).solana) {
      const phantomPublicKey = (window as any).solana.publicKey;

      if (phantomPublicKey) {
        console.log('🔍 Wallet Detection:');
        console.log('  useWallet:', walletAdapterKey?.toBase58());
        console.log('  Phantom:', phantomPublicKey.toBase58());

        // Check for mismatch
        if (walletAdapterKey && walletAdapterKey.toBase58() !== phantomPublicKey.toBase58()) {
          console.warn('⚠️ WALLET MISMATCH - Using Phantom wallet');
          console.warn('  Adapter:', walletAdapterKey.toBase58());
          console.warn('  Phantom:', phantomPublicKey.toBase58());
        }

        // Always use Phantom's publicKey if available
        setResolvedPublicKey(phantomPublicKey);
        return;
      }
    }

    // Fallback to wallet adapter
    setResolvedPublicKey(walletAdapterKey);
  }, [walletAdapterKey, connected]);

  return {
    publicKey: resolvedPublicKey,
    connected,
    connect,
  };
}
