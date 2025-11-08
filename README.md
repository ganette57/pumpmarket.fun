# 🚀 Funmarket.pump

**Polymarket meets PumpFun on Solana** - Create and trade prediction markets with bonding curves. Built for degens, secured against degeneracy.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Solana](https://img.shields.io/badge/Solana-Devnet-green.svg)

## 🎯 Features

- ✅ **Prediction Markets** - Create YES/NO markets on anything
- ✅ **Bonding Curve Pricing** - Early buyers get better prices
- ✅ **1% Creator Fees** - Earn fees on every trade in your market
- ✅ **Banned Words Filter** - Strict content moderation (no illegal/NSFW content)
- ✅ **Rate Limiting** - Max 5 active markets per wallet
- ✅ **Admin Resolution** - Market creators resolve outcomes (MVP)
- 🔜 **Chainlink Oracle** - Automated resolution for price feeds (V1)
- 🔜 **UMA/Reality.eth** - Decentralized resolution for subjective markets (V2)

## 🏗️ Architecture

```
funmarket.pump/
├── programs/funmarket-pump/    # Solana smart contract (Rust/Anchor)
│   └── src/
│       ├── lib.rs             # Main program logic
│       └── chainlink.rs       # Chainlink integration (V1)
├── app/                       # Next.js frontend
│   └── src/
│       ├── app/               # Pages (Home, Create, Trade, Dashboard)
│       ├── components/        # React components
│       └── utils/             # Solana utilities + banned words filter
└── tests/                     # Integration tests
```

## 🛠️ Setup (5 minutes)

### Prerequisites

- Node.js 18+
- Rust 1.75+
- Solana CLI 1.18+
- Anchor 0.29+

### 1. Install Solana & Anchor

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Verify installations
solana --version
anchor --version
```

### 2. Create Wallet & Get Devnet SOL

```bash
# Generate new keypair
solana-keygen new --outfile ~/.config/solana/id.json

# Set to devnet
solana config set --url https://api.devnet.solana.com

# Airdrop SOL
solana airdrop 5
```

### 3. Clone & Install Dependencies

```bash
git clone https://github.com/yourusername/funmarket.pump.git
cd funmarket.pump

# Install frontend deps
cd app
npm install
cd ..
```

## 🚀 Deployment

### Deploy Smart Contract to Devnet

```bash
# Build program
anchor build

# Get program ID
solana address -k target/deploy/funmarket_pump-keypair.json

# Update Anchor.toml and lib.rs with the program ID
# Replace "FunMktPumpXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" with your actual program ID

# Rebuild with correct ID
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show <YOUR_PROGRAM_ID> --url devnet
```

### Deploy Frontend to Vercel

```bash
cd app

# Update src/utils/solana.ts with your deployed program ID
# Replace PROGRAM_ID with your actual program ID

# Build
npm run build

# Deploy to Vercel
npm install -g vercel
vercel --prod
```

## 🧪 Testing

### Test Market Creation Flow

1. **Create User Counter**
   ```bash
   # First time only - initialize your user counter
   anchor run test-init-counter
   ```

2. **Create Market**
   - Go to `/create`
   - Try: "Will SOL hit $500 in 2025?" ✅
   - Try: "Will I kill someone on stream?" ❌ BLOCKED
   - Question must be 10-200 chars
   - Description max 500 chars

3. **Trade on Market**
   - Go to market page
   - Buy YES or NO shares
   - Watch bonding curve update
   - Check fees going to creator

4. **Resolve Market**
   - Go to Dashboard
   - Click "Resolve YES" or "Resolve NO"
   - Only works after resolution time
   - Only creator can resolve (MVP)

## 🔒 Security Features

### Banned Words Filter

**Contract-level (Rust):**
```rust
const BANNED_WORDS: [&str; 20] = [
    "pedo", "child", "rape", "suicide", "kill", "porn", "dick", "cock",
    "pussy", "fuck", "nigger", "hitler", "terror", "bomb", "isis",
    "murder", "death", "underage", "minor", "assault"
];
```

**UI-level (TypeScript):**
- Real-time validation in Create page
- Red border + error message on match
- Submit button disabled
- Same word list as contract

### Rate Limiting

- Max 5 active markets per wallet
- Enforced via PDA counter
- Prevents spam

### Bonding Curve Economics

```
Price = base_price + (current_supply / 100000)
Cost = amount * price
Fee = cost * 0.01 (1%)
Total = cost + fee
```

## 📊 Program Accounts

### Market
```rust
pub struct Market {
    pub creator: Pubkey,
    pub question: String,        // Max 200 chars
    pub description: String,     // Max 500 chars
    pub resolution_time: i64,
    pub yes_supply: u64,
    pub no_supply: u64,
    pub total_volume: u64,
    pub fees_collected: u64,
    pub resolved: bool,
    pub winning_outcome: Option<bool>,
}
```

### UserPosition
```rust
pub struct UserPosition {
    pub market: Pubkey,
    pub user: Pubkey,
    pub yes_shares: u64,
    pub no_shares: u64,
}
```

### UserCounter
```rust
pub struct UserCounter {
    pub authority: Pubkey,
    pub active_markets: u8,     // Max 5
}
```

## 🔮 Roadmap

### V1 - Chainlink Oracle (Q2 2025)
- [ ] Integrate Chainlink Data Feeds
- [ ] Auto-resolve BTC/USD, ETH/USD, SOL/USD markets
- [ ] Set target price + direction
- [ ] No manual resolution needed

Example:
```rust
// "Will BTC hit $100k?"
resolve_with_chainlink(
    target_price: 100_000_00000000,  // $100k with decimals
    above_target: true,
    chainlink_feed: BTC_USD_FEED
)
```

### V2 - Decentralized Resolution (Q3 2025)
- [ ] UMA Optimistic Oracle
- [ ] Reality.eth integration
- [ ] Subjective market resolution
- [ ] Dispute mechanism

### V3 - Advanced Features (Q4 2025)
- [ ] Multi-outcome markets (>2 options)
- [ ] Live streaming integration
- [ ] Social features (comments, likes)
- [ ] Mobile app (React Native)
- [ ] Analytics dashboard

## 🎨 UX Inspiration

**Polymarket**
- Clean dark mode
- Card-based market display
- Blue/Red percentage indicators
- Professional feel

**PumpFun**
- Flashy green buttons
- Live bonding curve charts
- Fun, high-energy design
- Degen vibes

## 📝 Example Markets

### Valid ✅
- "Will SOL reach $500 in 2025?"
- "Will Bitcoin ETF approval happen this year?"
- "Will Solana process 1M TPS by 2026?"
- "Will Trump win 2024 election?"

### Blocked ❌
- Anything with violence/illegal activity
- NSFW content
- Hate speech
- Suicide/self-harm
- Underage content

## 🛡️ Legal

This is **experimental software** on **devnet only**. NOT FOR PRODUCTION.

- Markets are for entertainment/education
- No real money involved (devnet SOL has no value)
- Not financial advice
- Not a gambling platform
- Comply with your local laws

## 🤝 Contributing

PRs welcome! Focus areas:
- Chainlink integration
- Additional oracle sources
- UI/UX improvements
- Security audits
- Test coverage

## 📄 License

MIT License - See LICENSE file

## 🔗 Links

- **Demo**: [funmarket-pump.vercel.app](https://funmarket-pump.vercel.app)
- **Program**: [Solana Explorer](https://explorer.solana.com/address/YOUR_PROGRAM_ID?cluster=devnet)
- **Docs**: [Anchor Documentation](https://www.anchor-lang.com/)
- **Chainlink**: [Solana Feeds](https://docs.chain.link/data-feeds/solana)

## 💬 Support

Issues? Questions? Open a GitHub issue or reach out on Twitter.

Built with ⚡ by degens, for degens.

---

**Remember**: We're thugs, not criminals. Keep it fun, keep it legal. 🚀
