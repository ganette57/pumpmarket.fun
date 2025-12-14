# 🚀 Deployment Guide - Funmarket.pump

Complete step-by-step guide to deploy Funmarket.pump to Solana Devnet + Vercel.

## Prerequisites Checklist

- [ ] Solana CLI installed
- [ ] Anchor CLI installed
- [ ] Node.js 18+ installed
- [ ] Git installed
- [ ] Vercel account (free tier works)
- [ ] At least 5 SOL on devnet

## Step 1: Environment Setup (10 min)

### Create Solana Wallet

```bash
# Generate new keypair (save this - it's your wallet!)
solana-keygen new --outfile ~/.config/solana/id.json

# View your public key
solana-keygen pubkey ~/.config/solana/id.json

# Set cluster to devnet
solana config set --url https://api.devnet.solana.com

# Verify config
solana config get
```

### Get Devnet SOL

```bash
# Get 5 SOL (repeat if needed)
solana airdrop 5

# Check balance
solana balance

# If airdrop fails, use web faucet:
# https://faucet.solana.com/
```

## Step 2: Build Smart Contract (5 min)

```bash
cd /path/to/funmarket.pump

# Build the program
anchor build

# This creates target/deploy/funmarket_pump-keypair.json
```

### Get Program ID

```bash
# Display your program ID
solana address -k target/deploy/funmarket_pump-keypair.json

# Copy this output - you'll need it!
# Example: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

## Step 3: Update Program ID (2 min)

### Update Anchor.toml

Replace placeholder in `Anchor.toml`:

```toml
[programs.devnet]
funmarket_pump = "YOUR_ACTUAL_PROGRAM_ID_HERE"  # Replace this

[programs.localnet]
funmarket_pump = "YOUR_ACTUAL_PROGRAM_ID_HERE"  # Replace this
```

### Update lib.rs

Replace placeholder in `programs/funmarket-pump/src/lib.rs`:

```rust
declare_id!("YOUR_ACTUAL_PROGRAM_ID_HERE");  // Line 4
```

### Rebuild with Correct ID

```bash
# Clean previous build
rm -rf target

# Rebuild
anchor build
```

## Step 4: Deploy to Devnet (5 min)

```bash
# Deploy program
anchor deploy --provider.cluster devnet

# Expected output:
# Program Id: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
# Deploy success
```

### Verify Deployment

```bash
# Check program exists on-chain
solana program show YOUR_PROGRAM_ID --url devnet

# Should show:
# Program Id: YOUR_PROGRAM_ID
# Owner: BPFLoaderUpgradeab1e11111111111111111111111
# ProgramData Address: ...
# Authority: YOUR_WALLET
# Last Deployed In Slot: ...
# Data Length: ... bytes
```

### Common Errors

**Error: Insufficient funds**
```bash
# Get more SOL
solana airdrop 5
```

**Error: Program ID mismatch**
```bash
# Make sure you updated BOTH Anchor.toml and lib.rs
# Then rebuild: anchor build
```

**Error: Failed to send transaction**
```bash
# Network congestion - retry
anchor deploy --provider.cluster devnet
```

## Step 5: Update Frontend Config (2 min)

### Update app/src/utils/solana.ts

```typescript
// Line 5 - replace with your program ID
export const PROGRAM_ID = new PublicKey('YOUR_ACTUAL_PROGRAM_ID_HERE');
```

## Step 6: Deploy Frontend to Vercel (10 min)

### Install Dependencies

```bash
cd app
npm install
```

### Test Build Locally

```bash
# Build
npm run build

# Test locally (optional)
npm run start
# Open http://localhost:3000
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel --prod

# Follow prompts:
# ? Set up and deploy "~/funmarket.pump/app"? [Y/n] y
# ? Which scope? [your-username]
# ? Link to existing project? [y/N] n
# ? What's your project's name? funmarket-pump
# ? In which directory is your code located? ./
```

### Vercel Configuration

If prompted, use these settings:
- Framework Preset: Next.js
- Root Directory: ./
- Build Command: npm run build
- Output Directory: .next
- Install Command: npm install

### Get Your Live URL

After deployment completes, Vercel will show:
```
✅ Production: https://funmarket-pump.vercel.app
```

## Step 7: Verify Everything Works (5 min)

### Test Checklist

1. **Visit Your Site**
   - Go to your Vercel URL
   - Should see homepage with "Degen Prediction Markets"

2. **Connect Wallet**
   - Click "Select Wallet" button
   - Connect Phantom (or Solflare)
   - Should show your wallet address

3. **Test Banned Words Filter**
   - Go to `/create`
   - Try: "Will SOL reach $500?" → ✅ Should work
   - Try: "Will I kill someone?" → ❌ Should show error

4. **Browse Markets**
   - Go back to home
   - Should see example markets (demo data)

## Step 8: Initialize Your First Market (Optional)

To create real markets, you need to initialize your user counter first:

### Create Test Script

Create `tests/init-user.ts`:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FunmarketPump } from "../target/types/funmarket_pump";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FunmarketPump as Program<FunmarketPump>;

  // Initialize user counter
  const [userCounterPDA] = await anchor.web3.PublicKey.findProgramAddress(
    [
      Buffer.from("user_counter"),
      provider.wallet.publicKey.toBuffer(),
    ],
    program.programId
  );

  try {
    await program.methods
      .initializeUserCounter()
      .accounts({
        userCounter: userCounterPDA,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✅ User counter initialized!");
    console.log("You can now create markets from the UI");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
```

### Run Test

```bash
# From project root
anchor run init-user
```

## Troubleshooting

### Program Not Found

```bash
# Verify program deployed
solana program show YOUR_PROGRAM_ID --url devnet

# If not found, redeploy
anchor deploy --provider.cluster devnet
```

### Transaction Simulation Failed

This usually means:
1. Program ID mismatch (frontend vs deployed)
2. User counter not initialized
3. Insufficient SOL in wallet

```bash
# Check wallet balance
solana balance

# Check program ID matches everywhere:
# - Anchor.toml
# - lib.rs (declare_id!)
# - app/src/utils/solana.ts (PROGRAM_ID)
```

### Frontend Build Errors

```bash
# Clear cache
rm -rf app/.next app/node_modules

# Reinstall
cd app
npm install
npm run build
```

## Post-Deployment Checklist

- [ ] Program deployed to devnet
- [ ] Program ID updated in all files
- [ ] Frontend deployed to Vercel
- [ ] Wallet connects successfully
- [ ] Banned words filter works
- [ ] Can view markets
- [ ] User counter initialized (if creating markets)

## Updating Your Deployment

### Update Smart Contract

```bash
# Make changes to programs/funmarket-pump/src/lib.rs

# Rebuild
anchor build

# Upgrade program (requires same wallet that deployed)
anchor upgrade target/deploy/funmarket_pump.so --program-id YOUR_PROGRAM_ID --provider.cluster devnet
```

### Update Frontend

```bash
cd app

# Make changes to src/

# Rebuild
npm run build

# Redeploy (from app directory)
vercel --prod
```

## Cost Breakdown

**Devnet (FREE):**
- Program deployment: ~5 SOL devnet (no real cost)
- Testing transactions: Minimal devnet SOL
- Total: $0 (devnet SOL has no value)

**Vercel (FREE TIER):**
- Hosting: Free
- Bandwidth: 100GB/month free
- Functions: Free for hobby projects

**Total MVP Cost: $0** 🎉

## Next Steps

1. Share your Vercel URL with friends
2. Create your first market
3. Test trading flow
4. Join Discord/Twitter for community
5. Plan V1 features (Chainlink integration)

## Support

Stuck? Common issues:
- Check all Program IDs match
- Ensure wallet has devnet SOL
- Verify Anchor.toml cluster setting
- Check browser console for errors

Open GitHub issue with:
- Error message
- Steps to reproduce
- `solana config get` output
- `anchor --version` output

---

**You're ready to launch! 🚀**
