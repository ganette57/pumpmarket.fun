import { supabase } from '@/utils/supabase';
import { Market } from '@/types/market';

/**
 * Indexes a market in Supabase with retry logic
 * PRODUCTION-READY: 3 retries with 1s delay
 */
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
      await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
    } catch (err) {
      console.error(`❌ Exception on retry ${i + 1}/3:`, err);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.error('❌ FAILED to index market in Supabase after 3 retries');
  return false;
}

/**
 * Retrieves ALL markets from Supabase
 * PRODUCTION-READY: Fallback to empty array if Supabase fails
 */
export async function getAllMarkets(): Promise<Market[]> {
  try {
    const { data, error } = await supabase
      .from('markets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Supabase getAllMarkets error:', error.message);
      console.log('🔄 Fallback: returning empty array');
      return [];
    }

    if (!data || data.length === 0) {
      console.log('ℹ️ No markets found in Supabase');
      return [];
    }

    console.log(`✅ Retrieved ${data.length} markets from Supabase`);
    return data as Market[];
  } catch (err) {
    console.error('❌ Exception in getAllMarkets:', err);
    return [];
  }
}

/**
 * Retrieves a single market by market_address
 * PRODUCTION-READY: Returns null if not found
 */
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

    if (!data) {
      console.log('ℹ️ Market not found:', marketAddress);
      return null;
    }

    console.log('✅ Retrieved market:', marketAddress);
    return data as Market;
  } catch (err) {
    console.error('❌ Exception in getMarketByAddress:', err);
    return null;
  }
}

/**
 * Updates market supply and volume after trades
 */
export async function updateMarketStats(
  marketAddress: string,
  updates: { yes_supply?: number; no_supply?: number; total_volume?: number }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('markets')
      .update(updates)
      .eq('market_address', marketAddress);

    if (error) {
      console.error('❌ Failed to update market stats:', error.message);
      return false;
    }

    console.log('✅ Market stats updated:', marketAddress);
    return true;
  } catch (err) {
    console.error('❌ Exception in updateMarketStats:', err);
    return false;
  }
}
