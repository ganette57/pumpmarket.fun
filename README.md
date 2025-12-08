# PumpMarket.fun 🚀

**Decentralized Prediction Markets on Solana**

Create, trade, and resolve prediction markets with instant indexing and reliable on-chain execution.

## ✨ Features

- ⚡ **Instant Market Indexing** - Markets appear on homepage within 5 seconds
- 💰 **Dual Fee System** - 1% creator fee + 1% platform fee on all trades
- 🔒 **Production-Ready** - 3-retry logic, fallback handling, error recovery
- 🎨 **Beautiful UI** - Modern, responsive interface with Tailwind CSS
- 📊 **Real-time Stats** - Live market data and trading volumes
- 🔗 **On-chain Powered** - All markets and trades verified on Solana

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment (see SETUP.md)
cp .env.example .env.local

# Run development server
npm run dev
```

See [SETUP.md](./SETUP.md) for complete setup instructions.

## 📁 Project Structure

```
src/
├── app/
│   ├── page.tsx              # Homepage - all markets
│   ├── create/page.tsx       # Create new market
│   ├── trade/[id]/page.tsx   # Trading interface
│   └── layout.tsx            # Root layout + nav
├── components/
│   └── WalletProvider.tsx    # Solana wallet integration
├── lib/
│   ├── markets.ts            # 🔥 Market indexing + retrieval
│   └── solana.ts             # On-chain interactions
├── types/
│   └── market.ts             # TypeScript types
└── utils/
    └── supabase.ts           # Database client
```

## 🎯 Core Functions

### `src/lib/markets.ts`

```typescript
// Index market with 3-retry logic
await indexMarket(marketData);

// Get all markets (fallback on failure)
const markets = await getAllMarkets();

// Get market by address
const market = await getMarketByAddress(marketAddress);
```

## 💻 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Blockchain**: Solana Web3.js
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS
- **Language**: TypeScript

## 🛠️ Development

```bash
npm run dev     # Start dev server
npm run build   # Build for production
npm run start   # Start production server
```

## 📊 Database

See `supabase-schema.sql` for complete schema.

Key tables:
- `markets` - All prediction markets
- `trades` - Individual trade history

## 🚢 Deployment

Ready for production deployment on:
- Vercel (recommended)
- Netlify
- AWS Amplify
- Railway

See [SETUP.md](./SETUP.md) for deployment guide.

## 📝 License

MIT

---

**Built for production. Ready to launch.** 🎉