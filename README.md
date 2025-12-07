# PumpMarket.fun

A decentralized prediction market platform powered by Solana blockchain and Supabase.

## Features

- **Create Markets**: Create prediction markets with custom questions, categories, and resolution dates
- **Trade**: Buy and sell YES/NO positions on market outcomes
- **Real-time Comments**: Engage with the community through real-time comments
- **Bookmarks**: Save your favorite markets for quick access
- **Dashboard**: Track your created markets and bookmarked markets
- **Solana Integration**: All markets are created on-chain with Solana
- **Supabase Backend**: Fast, scalable database with real-time subscriptions

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- **Blockchain**: Solana Web3.js, Wallet Adapter
- **Database**: Supabase (PostgreSQL with real-time)
- **Wallets**: Phantom, Solflare

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Solana wallet (Phantom or Solflare)
- Supabase account and project

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ganette57/pumpmarket.fun.git
cd pumpmarket.fun
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:

Create or update `.env.local` with your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://lrzxrciozsujfpxbazmq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
```

4. Set up Supabase tables:

The following tables should be created in your Supabase project:

**markets table:**
```sql
CREATE TABLE markets (
  id BIGSERIAL PRIMARY KEY,
  market_address TEXT UNIQUE NOT NULL,
  question TEXT NOT NULL,
  description TEXT,
  category TEXT,
  image_url TEXT,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  creator TEXT NOT NULL,
  social_links JSONB,
  yes_supply NUMERIC DEFAULT 0,
  no_supply NUMERIC DEFAULT 0,
  total_volume NUMERIC DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  resolution_result BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**comments table:**
```sql
CREATE TABLE comments (
  id BIGSERIAL PRIMARY KEY,
  market_id BIGINT REFERENCES markets(id) ON DELETE CASCADE,
  user_address TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**bookmarks table:**
```sql
CREATE TABLE bookmarks (
  id BIGSERIAL PRIMARY KEY,
  user_address TEXT NOT NULL,
  market_id BIGINT REFERENCES markets(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_address, market_id)
);
```

**transactions table:**
```sql
CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  market_id BIGINT REFERENCES markets(id) ON DELETE CASCADE,
  user_address TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('buy', 'sell')),
  outcome TEXT NOT NULL CHECK (outcome IN ('yes', 'no')),
  amount NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  tx_signature TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

5. Enable Realtime on the `comments` table in Supabase:
   - Go to Database → Replication
   - Enable replication for the `comments` table

### Development

Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

Build for production:
```bash
npm run build
npm run start
```

## Project Structure

```
pumpmarket.fun/
├── src/
│   ├── app/                    # Next.js app router pages
│   │   ├── create/            # Create market page
│   │   ├── dashboard/         # User dashboard
│   │   ├── market/[address]/  # Individual market page
│   │   ├── layout.tsx         # Root layout
│   │   ├── page.tsx           # Homepage
│   │   └── globals.css        # Global styles
│   ├── components/            # React components
│   │   ├── BookmarkButton.tsx # Bookmark functionality
│   │   ├── CommentsSection.tsx# Real-time comments
│   │   ├── Header.tsx         # Navigation header
│   │   ├── MarketCard.tsx     # Market display card
│   │   └── WalletProvider.tsx # Solana wallet provider
│   ├── types/                 # TypeScript types
│   │   └── database.types.ts  # Supabase database types
│   └── utils/                 # Utilities
│       └── supabase.ts        # Supabase client
├── .env.local                 # Environment variables
├── package.json
└── README.md
```

## Key Features Implementation

### 1. Market Creation (src/app/create/page.tsx)
- Creates market on Solana blockchain
- Indexes market data in Supabase
- Stores metadata (question, description, category, image, social links)

### 2. Homepage (src/app/page.tsx)
- Fetches and displays all markets from Supabase
- Real-time updates when new markets are created
- Sorted by creation date (newest first)

### 3. Dashboard (src/app/dashboard/page.tsx)
- Shows user's created markets
- Displays bookmarked markets
- Requires wallet connection

### 4. Real-time Comments (src/components/CommentsSection.tsx)
- Live comment updates using Supabase realtime
- User can post comments when wallet is connected
- Automatic refresh when new comments are added

### 5. Bookmarks (src/components/BookmarkButton.tsx)
- Toggle bookmark status
- Persists to Supabase database
- Syncs across user sessions

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | `https://xxxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anonymous key | `eyJhbGc...` |
| `NEXT_PUBLIC_SOLANA_RPC_ENDPOINT` | Solana RPC endpoint | `https://api.devnet.solana.com` |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License

## Support

For issues and questions, please open an issue on GitHub.
