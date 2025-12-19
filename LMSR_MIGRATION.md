# LMSR Migration Guide - Funmarket.pump

## Overview

Successfully migrated the Funmarket.pump prediction market from **bonding curve pricing** to **LMSR (Logarithmic Market Scoring Rule)** pricing.

## Key Changes

### 1. Smart Contract Changes (`programs/funmarket-pump/src/`)

#### New Files
- **`math.rs`**: Complete LMSR implementation with fixed-point arithmetic
  - Fixed-point exp() and ln() approximations using Taylor series
  - Scale factor: 1e9 (1_000_000_000) for precision
  - LMSR cost function: `C(q) = b * ln(sum_i exp(q_i/b))`
  - Buy cost: `C(q + Δ) - C(q)`
  - Sell refund: `C(q) - C(q - Δ)`

#### Modified Files
- **`lib.rs`**: Updated Market structure and instructions
  - **Market struct changes:**
    - ❌ Removed: `outcome_supplies: [u64; 10]`
    - ✅ Added: `q: [u64; 10]` (LMSR quantity shares)
    - ✅ Added: `b: u64` (liquidity parameter, default: 50 SOL)

  - **Instructions updated:**
    - `buy_shares`: Now uses LMSR pricing with 3% total fees (1% platform, 2% creator)
    - `sell_shares`: Uses LMSR refund calculation with fees
    - `resolve_market`: Unchanged
    - `claim_winnings`: Uses `q` instead of `outcome_supplies` for pro-rata payout

### 2. Fee Structure (UNCHANGED)
- **Platform fee**: 1% (100 basis points)
- **Creator fee**: 2% (200 basis points)
- **Total**: 3%
- Fees are immediately distributed on buy/sell transactions

### 3. Tests (`tests/funmarket-pump.ts`)
Comprehensive test suite covering:
- ✅ Market creation (binary and multi-choice)
- ✅ LMSR buy shares (cost increases as q increases)
- ✅ LMSR sell shares (refund with fees)
- ✅ Market expiration (no trades after end_ts)
- ✅ Resolution and claims (pro-rata payout)
- ✅ Fee verification
- ✅ Multi-outcome markets (2-10 outcomes)

## Deployment Instructions

### Step 1: Build the Program
```bash
anchor build
```

This will:
- Compile the Rust program with LMSR implementation
- Generate the new IDL in `target/idl/funmarket_pump.json`
- Create the program binary in `target/deploy/funmarket_pump.so`

### Step 2: Deploy to Devnet/Mainnet
```bash
# Devnet
anchor deploy --provider.cluster devnet

# Mainnet (when ready)
anchor deploy --provider.cluster mainnet-beta
```

**IMPORTANT**: Note the deployed program ID. If it changes, update:
1. `programs/funmarket-pump/src/lib.rs` - Line 7: `declare_id!("YOUR_NEW_PROGRAM_ID")`
2. `Anchor.toml` - Update program ID
3. Frontend `.env` or constants

### Step 3: Update Frontend

#### If Program ID Changed:
Update the program ID in your frontend app:

```typescript
// In your Next.js app (e.g., app/lib/program.ts or similar)
export const PROGRAM_ID = new PublicKey("YOUR_NEW_PROGRAM_ID");
```

#### Update IDL Types:
```bash
# Copy new IDL to frontend (if needed)
cp target/types/funmarket_pump.ts app/types/ # or wherever your types live
```

#### Frontend Code Review:
The frontend should continue working with minimal changes because:
- ✅ `buy_shares(amount, outcome_index)` - Same signature
- ✅ `sell_shares(amount, outcome_index)` - Same signature
- ✅ `resolve_market(winning_outcome_index)` - Same signature
- ✅ `claim_winnings()` - Same signature

**Only change needed**: Market struct now uses `q` instead of `outcome_supplies`

Example:
```typescript
// OLD
const yesSupply = market.outcomeSupplies[0];

// NEW
const yesQuantity = market.q[0];
```

### Step 4: Run Tests
```bash
# Run Anchor tests
anchor test

# If tests pass, deployment is verified!
```

### Step 5: Verify Frontend Compilation
```bash
cd app # or your frontend directory
npm run build
# or
yarn build
```

Ensure no TypeScript errors related to the IDL changes.

## Technical Details

### LMSR Parameters
- **b (liquidity parameter)**: 50 SOL (50_000_000_000 lamports)
  - Controls liquidity depth
  - Higher b = more liquidity, less price movement per trade
  - Set per market on creation

### Fixed-Point Math
- **Scale**: 1e9 (1_000_000_000)
- **Max exp input**: 40 (scaled) to prevent overflow
- **Convergence**: Taylor series with max 20 iterations

### Market Flow
1. **Create Market**: Initialize with `q = [0, 0, ..., 0]`, `b = 50 SOL`
2. **Buy Shares**:
   - Calculate cost: `C(q + amount) - C(q)`
   - Charge 3% fees
   - Update `q[outcome] += amount`
   - Update user position
3. **Sell Shares**:
   - Calculate refund: `C(q) - C(q - amount)`
   - Deduct 3% fees from refund
   - Update `q[outcome] -= amount`
4. **Resolve**: Set `winning_outcome`
5. **Claim**: Pro-rata payout based on `q[winning_outcome]`

## Breaking Changes

### ⚠️ IMPORTANT: Clean Restart
This migration **breaks compatibility** with existing markets because:
- Market struct layout changed (`outcome_supplies` → `q`, added `b`)
- Old markets cannot be read with new program

**Migration Strategy**:
- Deploy as a new program OR
- Ensure all old markets are resolved/claimed before upgrade

## Error Codes
New error code added:
- `InvalidLiquidityParameter`: If `b <= 0`

Existing errors unchanged:
- `InvalidOutcomeCount`
- `InsufficientShares`
- `MathOverflow`
- etc.

## UI/UX Notes

**NO UI CHANGES REQUIRED** for:
- CommentsSection
- MarketActivity
- TradingPanel layout
- Dashboard
- Claim/Resolve buttons

**Cost estimation**: Ensure frontend displays accurate cost/refund by calling:
```typescript
// Example pseudo-code
const cost = await program.methods
  .buyShares(amount, outcomeIndex)
  .accounts({ ... })
  .simulate(); // Get estimated cost including fees
```

## Verification Checklist

- [x] Program compiles without errors
- [x] LMSR math module implemented with fixed-point arithmetic
- [x] Buy/sell instructions use LMSR pricing
- [x] Fees (1% platform, 2% creator) applied correctly
- [x] Comprehensive tests written
- [x] Market struct updated (q, b fields)
- [x] Claim winnings uses new `q` field
- [ ] Anchor tests pass (run `anchor test`)
- [ ] Program deployed to devnet
- [ ] Frontend updated (if PROGRAM_ID changed)
- [ ] Frontend compiles
- [ ] End-to-end test on devnet

## Support

If you encounter issues:
1. Check program logs: `solana logs <PROGRAM_ID>`
2. Verify account sizes are correct
3. Ensure frontend IDL matches deployed program
4. Test on devnet first before mainnet

## Next Steps

1. Run `anchor test` to verify all tests pass
2. Deploy to devnet and test full flow
3. Update frontend if needed
4. Test on devnet with real wallets
5. Deploy to mainnet when ready

---

**Migration completed**: ✅
**Tests written**: ✅
**Ready for deployment**: ✅ (after running `anchor test`)
