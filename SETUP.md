# PumpMarket.fun - Production Setup Guide

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Run the entire contents of `supabase-schema.sql`
4. Get your project credentials from **Settings** → **API**

### 3. Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your values:

```env
# Supabase (REQUIRED)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Solana
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com  # or mainnet
NEXT_PUBLIC_SOLANA_NETWORK=devnet  # or mainnet-beta

# Fees (already set)
NEXT_PUBLIC_PLATFORM_FEE_PERCENTAGE=1
NEXT_PUBLIC_CREATOR_FEE_PERCENTAGE=1
```

### 4. Update Platform Wallet

In `src/app/trade/[id]/page.tsx`, replace the platform wallet address:

```typescript
const PLATFORM_WALLET = 'YOUR_PLATFORM_WALLET_ADDRESS_HERE';
```

### 5. Deploy Your Solana Program

**IMPORTANT**: Update the `PROGRAM_ID` in `src/lib/solana.ts` with your actual program ID:

```typescript
export const PROGRAM_ID = new PublicKey('YOUR_PROGRAM_ID_HERE');
```

### 6. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 7. Build for Production

```bash
npm run build
npm start
```

---

## 🎯 Key Features Implemented

### ✅ Reliable Market Indexing
- **3-retry logic** on Supabase insert failures
- Markets appear on homepage within 5 seconds of creation
- Fallback handling if Supabase is down

### ✅ Complete Trading Flow
- On-chain market creation
- Buy/Sell with automatic fee calculation
- **1% creator fee** on every trade
- **1% platform fee** on every trade
- Real-time market stats updates

### ✅ Production-Ready Pages
1. **Homepage** (`/`) - Lists all markets with live stats
2. **Create Market** (`/create`) - On-chain market creation with indexing
3. **Trade Page** (`/trade/[id]`) - Full trading interface with fees

### ✅ Developer Tools
- **Force Refresh button** (development mode only)
- Comprehensive error logging
- Transaction confirmation tracking

---

## 📊 Database Schema

The `markets` table stores:
- `market_address` - Unique on-chain PDA
- `question` - Market question (max 200 chars)
- `description` - Optional details
- `category` - Politics, Sports, Crypto, etc.
- `image_url` - Optional market image
- `end_date` - When market resolves
- `creator` - Wallet address of creator
- `yes_supply` - Total YES shares
- `no_supply` - Total NO shares
- `total_volume` - Lifetime volume in SOL
- `resolved` - Resolution status
- `resolution` - Final outcome (YES/NO)

---

## 🔧 Customization

### Change Fee Percentages

Edit `.env.local`:
```env
NEXT_PUBLIC_PLATFORM_FEE_PERCENTAGE=2  # Change to 2%
NEXT_PUBLIC_CREATOR_FEE_PERCENTAGE=0.5  # Change to 0.5%
```

### Add More Categories

Edit `src/app/create/page.tsx`:
```typescript
const categories = ['Politics', 'Sports', 'Crypto', 'Your Category'];
```

### Modify Market Card Display

Edit `src/app/page.tsx` - the market card rendering section

---

## 🚨 Pre-Launch Checklist

- [ ] Supabase project created and schema deployed
- [ ] Environment variables configured in `.env.local`
- [ ] Solana program deployed and `PROGRAM_ID` updated
- [ ] Platform wallet address updated
- [ ] Test market creation flow
- [ ] Test trading flow with fees
- [ ] Verify markets appear on homepage
- [ ] Test on mainnet with small amounts
- [ ] Remove or disable Force Refresh button for production

---

## 🔒 Security Notes

1. **Never commit `.env.local`** - it's in `.gitignore`
2. **Use environment variables** for all sensitive data
3. **Test on devnet first** before mainnet deployment
4. **Verify program ID** matches your deployed program
5. **Audit Solana program** before mainnet launch

---

## 📦 Deployment

### Vercel (Recommended)

```bash
vercel deploy --prod
```

Add environment variables in Vercel dashboard:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SOLANA_RPC_URL`
- `NEXT_PUBLIC_SOLANA_NETWORK`

### Other Platforms

Works with any Next.js 14 compatible host:
- Netlify
- AWS Amplify
- Railway
- Render

---

## 🐛 Troubleshooting

### Markets not appearing on homepage
1. Check Supabase connection in browser console
2. Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Check Supabase table has data: `SELECT * FROM markets;`
4. Look for retry errors in console

### Transaction failures
1. Ensure wallet has sufficient SOL
2. Check `PROGRAM_ID` is correct
3. Verify network (devnet vs mainnet)
4. Check RPC endpoint is responsive

### "Market not found" on trade page
1. Verify market was indexed (check Supabase)
2. Check `market_address` matches exactly
3. Wait a few seconds and refresh

---

## 📞 Support

Built with:
- Next.js 14 (App Router)
- Solana Web3.js
- Supabase
- TailwindCSS
- TypeScript

Ready for production launch! 🚀
