import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";

export const PROGRAM_ID = new PublicKey(
  "FomHPbnvgSp7qLqAJFkDwut3MygPG9cmyK5TwebSNLTg"
);
export const NETWORK = clusterApiUrl("devnet");
export const PLATFORM_WALLET = new PublicKey(
  "7DVR8gnBbLYN1aAAhbEJpNLxdzPzuqwAPaLRCRt4v93Z"
);

export function getConnection(): Connection {
  return new Connection(NETWORK, "confirmed");
}

export function getProvider(wallet: AnchorWallet, connection: Connection): AnchorProvider {
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

// ----------------------------
// Seed-safe helpers (<= 32 bytes)
// ----------------------------
export function randomBase36(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

/**
 * Seeds (for PDA) must be <= 32 bytes.
 * We build a short seed like: "<trimmed>~abc123"
 */
export function makeSeededQuestion(displayQuestion: string, suffix: string) {
  const clean = displayQuestion.trim().replace(/\s+/g, " ");
  const tag = `~${suffix}`;
  const maxBytes = 32;

  const tagBytes = Buffer.byteLength(tag, "utf8");

  let base = clean;
  while (Buffer.byteLength(base, "utf8") + tagBytes > maxBytes) {
    base = base.slice(0, -1);
    if (!base.length) break;
  }

  base = base.trim();
  if (!base) base = "market";

  return `${base}${tag}`;
}

/**
 * Throws if the seed is > 32 bytes (Anchor PDA constraint)
 */
export function assertSeed32(label: string, seed: string) {
  const bytes = Buffer.byteLength(seed, "utf8");
  if (bytes > 32) {
    throw new Error(
      `${label} seed too long: ${bytes} bytes (>32). Use makeSeededQuestion() to generate a seed-safe question.`
    );
  }
}

/**
 * Get market PDA from a *seeded question* (must be <= 32 bytes).
 * IMPORTANT: this question string must match the on-chain createMarket(question, ...) arg.
 */
export function getMarketPDA(creator: PublicKey, questionSeed: string): [PublicKey, number] {
  assertSeed32("market.question", questionSeed);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), Buffer.from(questionSeed, "utf8")],
    PROGRAM_ID
  );
}

/**
 * Helper to find a free PDA (avoid "already in use") by trying random suffixes.
 */
export async function deriveFreeMarketPda(
  connection: Connection,
  creator: PublicKey,
  displayQuestion: string,
  tries = 10
): Promise<{ marketPda: PublicKey; bump: number; seededQuestion: string; suffix: string }> {
  for (let i = 0; i < tries; i++) {
    const suffix = randomBase36(6);
    const seededQuestion = makeSeededQuestion(displayQuestion, suffix);
    const [marketPda, bump] = getMarketPDA(creator, seededQuestion);

    const info = await connection.getAccountInfo(marketPda);
    if (!info) return { marketPda, bump, seededQuestion, suffix };
  }
  throw new Error("Could not find a free market PDA. Try changing the question.");
}

// ----------------------------
// Other PDAs
// ----------------------------
export function getUserCounterPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_counter"), authority.toBuffer()],
    PROGRAM_ID
  );
}

export function getUserPositionPDA(market: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), user.toBuffer()],
    PROGRAM_ID
  );
}

// ----------------------------
// Pricing helpers (UI only)
// ----------------------------
export function calculateBondingCurvePrice(currentSupply: number): number {
  const basePrice = 0.01;
  const pricePerUnit = basePrice + currentSupply / 100000;
  return pricePerUnit;
}

export function calculateBuyCost(currentSupply: number, amount: number): number {
  const basePrice = 0.01;
  const price = basePrice + currentSupply / 100000;
  const cost = amount * price;
  const fee = cost * 0.01;
  return cost + fee;
}

// ----------------------------
// Lamports helpers
// ----------------------------
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * 1_000_000_000);
}