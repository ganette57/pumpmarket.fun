const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://lrzxrciozsujfpxbazmq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyenhyY2lvenN1amZweGJhem1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwOTM0NTIsImV4cCI6MjA4MDY2OTQ1Mn0.cEttd9IpqpPuAyV1jOsnZftnGH2w35tkslouNWHGs44';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('Testing Supabase connection...');
  
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .limit(1);
  
  if (error) {
    console.error('❌ Error:', error);
  } else {
    console.log('✅ Connected! Data:', data);
  }
}

test();
