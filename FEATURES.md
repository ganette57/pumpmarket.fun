# 🎯 Features Documentation

Complete feature list for Funmarket.pump.

## Core Features (MVP)

### 1. Prediction Markets

**Create Markets**
- Binary YES/NO outcomes
- Custom questions (10-200 chars)
- Optional descriptions (max 500 chars)
- Configurable resolution time (1 day to 6 months)
- Automatic question validation

**Market States**
- Active: Open for trading
- Expired: Past resolution time, pending resolution
- Resolved: Outcome determined, ready for claims

### 2. Bonding Curve Pricing

**Price Formula**
```
price_per_share = base_price + (current_supply / 100000)
```

**Benefits**
- Early buyers get better prices
- Price discovery through supply/demand
- Automatic market making
- No order book needed
- Instant liquidity

**Examples**
| Supply | Price per Share |
|--------|----------------|
| 0      | 0.01 SOL      |
| 1000   | 0.02 SOL      |
| 10000  | 0.11 SOL      |
| 100000 | 1.01 SOL      |

### 3. Fee System

**Split Fees: 2% Total (1% Creator + 1% Platform)**
- Charged on every trade (buy & sell)
- 1% paid to market creator
- 1% paid to platform wallet
- Incentivizes quality market creation
- Sustainable revenue model

**Example Trade**
```
Buy 100 shares at 0.01 SOL each
Cost: 1.00 SOL
Creator Fee: 0.01 SOL (1%)
Platform Fee: 0.01 SOL (1%)
Total: 1.02 SOL

Creator receives: 0.01 SOL
Platform receives: 0.01 SOL
Market receives: 1.00 SOL
```

### 4. Content Moderation

**Banned Words Filter**
20 banned words enforced at contract + UI level:
- Violence: kill, murder, assault
- Illegal: pedo, child, rape, underage, minor
- NSFW: porn, dick, cock, pussy
- Hate: nigger, hitler
- Terrorism: terror, bomb, isis
- Self-harm: suicide, death

**Enforcement**
- Contract-level: Transaction fails
- UI-level: Real-time validation, submit disabled
- Both levels use same word list

### 5. Rate Limiting

**Per-Wallet Limits**
- Max 5 active markets per wallet
- Enforced via PDA counter
- Counter decrements when market resolved
- Prevents spam/abuse

### 6. Resolution System

**MVP: Manual Resolution**
- Creator-controlled
- Requires resolution time passed
- Cannot be changed once resolved
- Decrements active market count

**V1: Chainlink Oracle (Planned)**
- Automated price feeds (BTC, ETH, SOL)
- Trustless resolution
- Set target price + direction
- Auto-resolves at resolution time

**V2: Decentralized Oracle (Planned)**
- UMA Optimistic Oracle
- Community-driven resolution
- Dispute mechanism
- Subjective outcomes

### 7. User Positions

**Position Tracking**
- YES shares owned
- NO shares owned
- Per-market tracking
- Claim winnings after resolution

**Payout Structure**
- Winning shares: 1 SOL per share (simplified MVP)
- Losing shares: 0
- Automatic calculation
- One-click claim

## Frontend Features

### 1. Wallet Integration

**Supported Wallets**
- Phantom (recommended)
- Solflare
- Auto-reconnect on page reload
- Session persistence

**Network**
- Solana Devnet
- Automatic cluster detection
- Balance display

### 2. Pages

**Home**
- Grid of active markets
- Filter: All / Active / Resolved
- Card display with:
  - Question
  - YES/NO percentages
  - Volume
  - Time remaining
- Click to trade

**Create**
- One-page form
- Real-time validation
- Character counters
- Banned word detection (red border)
- Error messages
- Resolution time picker
- Submit only when valid

**Trade**
- Market details
- Current odds display
- Bonding curve chart (Chart.js)
- YES/NO tabs
- Amount selector
- Cost calculator
- User position display
- Buy button

**Dashboard**
- My Markets section:
  - Markets created
  - Volume & fees earned
  - Resolve buttons (when ready)
- My Positions section:
  - Active positions
  - Shares owned
  - Claim buttons (when resolved)

### 3. UX/UI Design

**Inspiration**
- Polymarket: Clean, professional dark mode
- PumpFun: Fun, high-energy, flashy

**Color Scheme**
- Background: Dark (#0a0a0a)
- Primary: Pump Green (#00ff88)
- Secondary: Pump Red (#ff0055)
- YES: Blue (#3b82f6)
- NO: Red (#ef4444)

**Components**
- Card-based layout
- Hover effects
- Smooth transitions
- Glow animations
- Responsive design
- Mobile-friendly

### 4. Bonding Curve Visualization

**Chart Features**
- Real-time price curve
- Current supply indicator
- Interactive tooltips
- Responsive sizing
- Price per share on Y-axis
- Supply on X-axis

**Updates**
- Live updates after trades
- Smooth animations
- Color-coded (blue for YES, red for NO)

## Security Features

### 1. Input Validation

**Contract Level**
- Question length: 10-200 chars
- Description length: max 500 chars
- Banned words check
- Resolution time > current time
- Numeric bounds on amounts
- Pubkey validation

**UI Level**
- Duplicate validation
- Real-time feedback
- Submit prevention
- Type safety (TypeScript)

### 2. Access Control

**Market Creation**
- Anyone can create (with counter)
- Creator pays gas + rent

**Resolution**
- Only creator (MVP)
- Only after resolution time
- One-time only

**Claiming**
- Only position owner
- Only after resolution
- Only winning shares

### 3. Economic Security

**Anti-Spam**
- Max 5 markets per wallet
- Rent costs for spam
- Fee incentives for quality

**Anti-Manipulation**
- Bonding curve prevents price manipulation
- On-chain transparency
- Immutable outcomes

## Technical Features

### 1. Smart Contract

**Architecture**
- Anchor framework
- PDA-based accounts
- Zero-copy where possible
- Efficient rent management

**Accounts**
- Market: Market data
- UserPosition: Shares owned
- UserCounter: Active market count

**Instructions**
- initialize_user_counter
- create_market
- buy_shares
- sell_shares
- resolve_market
- claim_winnings

### 2. Frontend

**Stack**
- Next.js 14 (App Router)
- React 18
- TypeScript
- Tailwind CSS
- Chart.js for visualizations

**Solana Integration**
- @solana/web3.js
- @solana/wallet-adapter
- @coral-xyz/anchor

**Performance**
- Static generation where possible
- Client-side rendering for dynamic data
- Optimized images
- Code splitting

### 3. Deployment

**Smart Contract**
- Solana Devnet
- Upgradeable program
- ~10-15 KB program size

**Frontend**
- Vercel (recommended)
- Netlify compatible
- Any static host

## Future Features (Roadmap)

### V1 (Q2 2025)
- [ ] Chainlink price feeds integration
- [ ] Auto-resolve markets
- [ ] Email notifications
- [ ] Market search/filter
- [ ] Market categories

### V2 (Q3 2025)
- [ ] UMA/Reality.eth oracle
- [ ] Multi-outcome markets (>2 options)
- [ ] Social features (comments, likes)
- [ ] User profiles
- [ ] Leaderboard

### V3 (Q4 2025)
- [ ] Live streaming integration
- [ ] Mobile app (React Native)
- [ ] Advanced analytics
- [ ] API for developers
- [ ] Liquidity pools

## Analytics & Metrics

**On-Chain Data**
- Total markets created
- Total volume traded
- Total fees collected
- Active users
- Resolution accuracy

**User Metrics**
- Markets created per user
- Win/loss ratio
- Total profits
- Trading volume

**Market Metrics**
- Average volume per market
- Time to resolution
- Outcome distribution
- Price volatility

## Compliance Features

**Content Policy**
- Strict banned words list
- Manual review option (future)
- Report button (future)
- Terms of service enforcement

**Legal Protection**
- Devnet only (no real money)
- Educational disclaimer
- Age verification (future)
- Jurisdiction restrictions (future)

---

**Feature Status Legend:**
- ✅ Implemented
- 🔜 Planned (next version)
- [ ] Roadmap item
