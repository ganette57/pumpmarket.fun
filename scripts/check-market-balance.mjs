import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

const addr = process.argv[2];
if (!addr) {
  console.log("Usage: node scripts/check-market-balance.mjs <MARKET_ADDRESS>");
  process.exit(1);
}

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const pk = new PublicKey(addr);

const info = await connection.getAccountInfo(pk);
if (!info) {
  console.log("❌ Account not found on devnet:", addr);
  process.exit(0);
}

console.log("✅ Found account:", addr);
console.log("Lamports:", info.lamports);
console.log("SOL:", info.lamports / 1e9);
console.log("Owner:", info.owner.toBase58());
console.log("Data length:", info.data.length);