const { Connection, Keypair } = require('@solana/web3.js');
const { CrossbarClient } = require('@switchboard-xyz/on-demand');
const fs = require('fs');

async function setupOracle() {
  const connection = new Connection('https://api.devnet.solana.com');
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8')))
  );

  console.log('🔍 Setting up Switchboard On-Demand Oracle...');
  console.log('Payer:', payer.publicKey.toBase58());
  console.log('Balance:', (await connection.getBalance(payer.publicKey)) / 1e9, 'SOL');

  // Switchboard On-Demand uses pull-based feeds
  console.log('\n📚 Switchboard On-Demand Architecture:');
  console.log('1. Create feed definitions (JSON jobs)');
  console.log('2. Pull oracle data when needed (on-demand)');
  console.log('3. No continuous updates = cheaper!');
  
  console.log('\n✅ SDK installed! Ready for next steps!');
  console.log('\nNext: Create a feed definition for BTC/USD price');
}

setupOracle().catch(console.error);
