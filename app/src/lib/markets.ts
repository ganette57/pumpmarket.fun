import { supabase } from '@/utils/supabase';
import { Market } from '@/types/market';

export async function indexMarket(marketData: Omit<Market, 'id' | 'created_at' | 'updated_at'>): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      const { error } = await supabase
        .from('markets')
        .insert(marketData);
      
      if (!error) {
        console.log('✅ Market indexed successfully:', marketData.market_address);
        return true;
      }
      
      console.warn(`⚠️ Retry ${i + 1}/3 - Supabase error:`, error.message);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`❌ Exception on retry ${i + 1}/3:`, err);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  console.error('❌ FAILED to index market in Supabase after 3 retries');
  return false;
}

export async function getAllMarkets(): Promise<Market[]> {
  try {
    const { data, error } = await supabase
      .from('markets')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Supabase getAllMarkets error:', error.message);
      return [];
    }
    
    console.log(`✅ Retrieved ${data?.length || 0} markets from Supabase`);
    return data as Market[];
  } catch (err) {
    console.error('❌ Exception in getAllMarkets:', err);
    return [];
  }
}

export async function getMarketByAddress(marketAddress: string): Promise<Market | null> {
  try {
    const { data, error } = await supabase
      .from('markets')
      .select('*')
      .eq('market_address', marketAddress)
      .single();
    
    if (error) {
      console.error('❌ Supabase getMarketByAddress error:', error.message);
      return null;
    }
    
    return data as Market;
  } catch (err) {
    console.error('❌ Exception in getMarketByAddress:', err);
    return null;
  }
}
/**
 * Retrieves markets created by a specific creator
 */
export async function getMarketsByCreator(creatorAddress: string): Promise<Market[]> {
  try {
    const { data, error } = await supabase
      .from('markets')
      .select('*')
      .eq('creator', creatorAddress)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Supabase getMarketsByCreator error:', error.message);
      return [];
    }
    
    console.log(`✅ Retrieved ${data?.length || 0} markets for creator ${creatorAddress}`);
    return data as Market[];
  } catch (err) {
    console.error('❌ Exception in getMarketsByCreator:', err);
    return [];
  }
}