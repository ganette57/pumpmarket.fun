export interface Market {
  id?: number;
  market_address: string;
  creator: string;
  question: string;
  description?: string;
  category: string;
  end_date: string;
  image_url?: string;
  yes_supply: number;
  no_supply: number;
  total_volume: number;
  is_resolved: boolean;
  winning_outcome?: 'YES' | 'NO';
  created_at?: string;
  updated_at?: string;
}
