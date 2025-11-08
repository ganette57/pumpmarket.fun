import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Program, AnchorProvider, Idl, setProvider } from '@coral-xyz/anchor';
import { AnchorWallet } from '@solana/wallet-adapter-react';

export const PROGRAM_ID = new PublicKey('FunMktPumpXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
export const NETWORK = clusterApiUrl('devnet');

export function getConnection(): Connection {
  return new Connection(NETWORK, 'confirmed');
}

export function getProvider(wallet: AnchorWallet): AnchorProvider {
  const connection = getConnection();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  return provider;
}

// Calculate bonding curve price
export function calculateBondingCurvePrice(currentSupply: number): number {
  const basePrice = 0.01; // 0.01 SOL
  const pricePerUnit = basePrice + (currentSupply / 100000); // Increment per supply
  return pricePerUnit;
}

// Calculate cost for buying amount of shares
export function calculateBuyCost(currentSupply: number, amount: number): number {
  const basePrice = 0.01;
  const price = basePrice + (currentSupply / 100000);
  const cost = amount * price;
  const fee = cost * 0.01; // 1% fee
  return cost + fee;
}

// Get market PDA
export function getMarketPDA(creator: PublicKey, question: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('market'),
      creator.toBuffer(),
      Buffer.from(question),
    ],
    PROGRAM_ID
  );
}

// Get user counter PDA
export function getUserCounterPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('user_counter'),
      authority.toBuffer(),
    ],
    PROGRAM_ID
  );
}

// Get user position PDA
export function getUserPositionPDA(market: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      market.toBuffer(),
      user.toBuffer(),
    ],
    PROGRAM_ID
  );
}

// Format lamports to SOL
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

// Format SOL to lamports
export function solToLamports(sol: number): number {
  return Math.floor(sol * 1_000_000_000);
}
