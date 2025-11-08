# ⚡ Quick Start - 5 Minutes to Launch

Get Funmarket.pump running locally in 5 minutes.

## 1. Install Tools (60 seconds)

```bash
# Solana
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked
```

## 2. Setup Wallet (30 seconds)

```bash
solana-keygen new --outfile ~/.config/solana/id.json
solana config set --url https://api.devnet.solana.com
solana airdrop 5
```

## 3. Build & Deploy Program (90 seconds)

```bash
# Clone repo
git clone https://github.com/yourusername/funmarket.pump.git
cd funmarket.pump

# Build
anchor build

# Get program ID
PROGRAM_ID=$(solana address -k target/deploy/funmarket_pump-keypair.json)
echo "Your Program ID: $PROGRAM_ID"

# Update Anchor.toml and lib.rs with your program ID
# Then rebuild
anchor build

# Deploy
anchor deploy --provider.cluster devnet
```

## 4. Deploy Frontend (90 seconds)

```bash
cd app

# Install
npm install

# Update src/utils/solana.ts with your program ID

# Deploy to Vercel
npx vercel --prod
```

## 5. Test It (60 seconds)

1. Open your Vercel URL
2. Connect Phantom wallet
3. Go to Create
4. Try: "Will SOL hit $500?" ✅
5. Try: "Will I kill someone?" ❌ Blocked!

## Done! 🎉

Your prediction market is live on Solana devnet.

## Next Steps

- Create your first real market
- Share with friends
- Test trading
- Read DEPLOYMENT.md for details

## Troubleshooting

**Build fails?**
```bash
rustup update
cargo clean
anchor build
```

**Deploy fails?**
```bash
solana airdrop 5
anchor deploy --provider.cluster devnet
```

**Frontend errors?**
```bash
cd app
rm -rf node_modules .next
npm install
npm run build
```

## Key Files to Edit

- `Anchor.toml` - Program ID (line 9 & 12)
- `programs/funmarket-pump/src/lib.rs` - Program ID (line 4)
- `app/src/utils/solana.ts` - Program ID (line 5)

All program IDs must match!

---

Need help? Check DEPLOYMENT.md or open an issue.
