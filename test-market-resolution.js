const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet } = require('@coral-xyz/anchor');
const fs = require('fs');
const idl = require('./app/src/idl/funmarket_pump.json');

const PROGRAM_ID = new PublicKey('FomHPbnvgSp7qLqAJFkDwut3MygPG9cmyK5TwebSNLTg');
const MARKET_ADDRESS = 'HBGJ96YZrryHYk4sZ7pxGH8UmQQeJeGgPS6MQMWHiFmL';

async function testMarket() {
  const connection = new Connection('https://api.devnet.solana.com');
  
  console.log('�� Testing market:', MARKET_ADDRESS);
  
  try {
    const marketPk = new PublicKey(MARKET_ADDRESS);
    
    // Fetch using connection.getAccountInfo
    const accountInfo = await connection.getAccountInfo(marketPk);
    
    if (!accountInfo) {
      console.log('❌ Market account not found!');
      return;
    }
    
    console.log('✅ Market account exists');
    console.log('  Data length:', accountInfo.data.length);
    console.log('  Owner:', accountInfo.owner.toBase58());
    
    // Try to decode with Program
    const dummyKeypair = Keypair.generate();
    const wallet = new Wallet(dummyKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl, provider);
    
    const marketAcc = await program.account.market.fetch(marketPk);
    
    console.log('\n📊 Market Data:');
    console.log('  Question:', marketAcc.question);
    console.log('  Creator:', marketAcc.creator.toBase58());
    console.log('  Resolved:', marketAcc.resolved);
    console.log('  Market Type:', marketAcc.marketType);
    console.log('  Outcome Count:', marketAcc.outcomeCount);
    console.log('  Resolution Time:', new Date(marketAcc.resolutionTime.toNumber() * 1000).toLocaleString());
    console.log('  Now:', new Date().toLocaleString());
    console.log('  Can Resolve?', !marketAcc.resolved && Date.now() >= marketAcc.resolutionTime.toNumber() * 1000);
    
    if (marketAcc.outcomeNames) {
      console.log('\n  Outcomes:');
      for (let i = 0; i < marketAcc.outcomeCount; i++) {
        console.log(`    ${i}: ${marketAcc.outcomeNames[i]}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }
}

testMarket();
