export interface Market {
  id?: number;
  market_address: string;
  question: string;
  description: string;
  category: string;
  image_url: string | null;
  end_date: string;
  creator: string;
  yes_supply: number;
  no_supply: number;
  total_volume: number;
  resolved: boolean;
  resolution?: 'YES' | 'NO' | null;
  created_at?: string;
  updated_at?: string;
}

export interface MarketCreateData {
  question: string;
  description: string;
  category: string;
  image_url?: string | null;
  end_date: Date;
  creator: string;
}
