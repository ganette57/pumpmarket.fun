import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('BV6q3zDwjaXdcn3DmqroHbeNuTDxtrpyYXvGNeYec6Wy');

export function getMarketPDA(creator: PublicKey, question: string): [PublicKey, number] {
  {
  const truncated = question.slice(0, 32);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), creator.toBuffer(), Buffer.from(truncated)],
    PROGRAM_ID
  );
}

export function getUserCounterPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_counter'), authority.toBuffer()],
    PROGRAM_ID
  );
}
