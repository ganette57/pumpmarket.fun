import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
} from '@solana/web3.js';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export const connection = new Connection(RPC_URL, 'confirmed');

// Program ID - REPLACE WITH YOUR ACTUAL PROGRAM ID
export const PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

/**
 * Creates a market on-chain
 * Returns the market PDA address
 */
export async function createMarketOnChain(
  wallet: any,
  marketData: {
    question: string;
    endDate: Date;
    creator: PublicKey;
  }
): Promise<string> {
  // Generate market PDA
  const marketSeed = `market_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const [marketPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(marketSeed)],
    PROGRAM_ID
  );

  // Build transaction (simplified - replace with your actual program instruction)
  const transaction = new Transaction();

  // This is a placeholder - replace with your actual program instruction
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: marketData.creator,
      toPubkey: marketPDA,
      lamports: 0.001 * LAMPORTS_PER_SOL, // Small rent for PDA
    })
  );

  // Sign and send
  const signature = await wallet.sendTransaction(transaction, connection);
  await connection.confirmTransaction(signature, 'confirmed');

  console.log('✅ Market created on-chain:', marketPDA.toBase58());
  console.log('📝 Transaction:', signature);

  return marketPDA.toBase58();
}

/**
 * Buys shares in a market
 * Includes 1% creator fee + 1% platform fee
 */
export async function buyShares(
  wallet: any,
  marketAddress: string,
  amount: number,
  isYes: boolean,
  creator: string,
  platform: string
): Promise<string> {
  const marketPDA = new PublicKey(marketAddress);
  const creatorPubkey = new PublicKey(creator);
  const platformPubkey = new PublicKey(platform);

  // Calculate fees
  const creatorFee = amount * 0.01; // 1%
  const platformFee = amount * 0.01; // 1%
  const totalCost = amount + creatorFee + platformFee;

  const transaction = new Transaction();

  // Transfer to market
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: marketPDA,
      lamports: amount * LAMPORTS_PER_SOL,
    })
  );

  // Creator fee
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: creatorPubkey,
      lamports: creatorFee * LAMPORTS_PER_SOL,
    })
  );

  // Platform fee
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: platformPubkey,
      lamports: platformFee * LAMPORTS_PER_SOL,
    })
  );

  const signature = await wallet.sendTransaction(transaction, connection);
  await connection.confirmTransaction(signature, 'confirmed');

  console.log(`✅ Bought ${amount} ${isYes ? 'YES' : 'NO'} shares`);
  console.log(`💰 Fees: ${creatorFee} SOL (creator) + ${platformFee} SOL (platform)`);

  return signature;
}
