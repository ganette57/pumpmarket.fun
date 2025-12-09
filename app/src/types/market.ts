export interface Market {
  id?: string;
  market_address: string;
  creator: string;
  question: string;
  description?: string;
  category?: string;
  end_date: string;
  image_url?: string;
  
  // Multi-choice support
  market_type: number;           // 0 = Binary, 1 = Multi-choice
  outcome_names: string[];       // ["YES", "NO"] or ["BTC", "ETH", "SOL"]
  outcome_supplies: number[];    // [1000, 800] or [500, 300, 200]
  
  // Legacy fields (kept for backward compatibility)
  yes_supply?: number;
  no_supply?: number;
  
  total_volume: number;
  resolved: boolean;
  winning_outcome?: number;      // Index of winning outcome (0, 1, 2, etc.)
  created_at?: string;
  updated_at?: string;
}