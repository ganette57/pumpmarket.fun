const fetch = require('node-fetch');

async function testFeed() {
  console.log('🧪 Testing BTC/USD feed...\n');
  
  try {
    const response = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
    const data = await response.json();
    
    console.log('✅ API Response:');
    console.log(JSON.stringify(data, null, 2));
    
    const price = parseFloat(data.data.amount);
    console.log('\n💰 Current BTC Price:', price, 'USD');
    
    console.log('\n✅ Feed is working! Ready to integrate with Switchboard!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testFeed();
