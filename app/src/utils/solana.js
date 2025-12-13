import { PublicKey } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('FomHPbnvgSp7qLqAJFkDwut3MygPG9cmyK5TwebSNLTg');

export function getMarketPDA(creator, question) {
  const truncated = question.slice(0, 32);
  const seeds = [
    Buffer.from('market'),
    creator.toBuffer(),
    Buffer.from(truncated)
  ];
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}

export function getUserCounterPDA(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_counter'), authority.toBuffer()],
    PROGRAM_ID
  );
}
