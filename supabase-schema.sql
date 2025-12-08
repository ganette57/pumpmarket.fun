-- PumpMarket.fun - Supabase Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Markets table
CREATE TABLE IF NOT EXISTS markets (
  id BIGSERIAL PRIMARY KEY,
  market_address TEXT UNIQUE NOT NULL,
  question TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  image_url TEXT,
  end_date TIMESTAMPTZ NOT NULL,
  creator TEXT NOT NULL,
  yes_supply DECIMAL(20, 9) DEFAULT 0,
  no_supply DECIMAL(20, 9) DEFAULT 0,
  total_volume DECIMAL(20, 9) DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  resolution TEXT CHECK (resolution IN ('YES', 'NO') OR resolution IS NULL),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_markets_market_address ON markets(market_address);
CREATE INDEX IF NOT EXISTS idx_markets_creator ON markets(creator);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_created_at ON markets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_resolved ON markets(resolved);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Optional: Trades table for tracking individual trades
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  market_address TEXT NOT NULL REFERENCES markets(market_address),
  trader TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  amount DECIMAL(20, 9) NOT NULL,
  signature TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_market_address ON trades(market_address);
CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Allow public read access on markets"
  ON markets FOR SELECT
  USING (true);

CREATE POLICY "Allow public read access on trades"
  ON trades FOR SELECT
  USING (true);

-- Insert policy (anyone can insert)
CREATE POLICY "Allow public insert on markets"
  ON markets FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public insert on trades"
  ON trades FOR INSERT
  WITH CHECK (true);

-- Update policy (only for stats updates)
CREATE POLICY "Allow public update on markets"
  ON markets FOR UPDATE
  USING (true)
  WITH CHECK (true);
