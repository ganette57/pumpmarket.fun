# 🧪 Testing Guide

Complete testing checklist for Funmarket.pump.

## Manual Testing Checklist

### Smart Contract Tests

#### ✅ Create Market
- [ ] Valid market creates successfully
- [ ] Question <10 chars rejected
- [ ] Question >200 chars rejected
- [ ] Banned word "kill" blocked
- [ ] Banned word "pedo" blocked
- [ ] Banned word "rape" blocked
- [ ] Description >500 chars rejected
- [ ] Resolution time in past rejected
- [ ] 6th market creation blocked (max 5)

#### ✅ Buy Shares
- [ ] Buy YES shares increases supply
- [ ] Buy NO shares increases supply
- [ ] Price increases with supply
- [ ] 1% fee charged correctly
- [ ] Fee goes to creator
- [ ] User position created/updated
- [ ] Cannot buy from resolved market
- [ ] Cannot buy after resolution time

#### ✅ Sell Shares
- [ ] Sell YES shares decreases supply
- [ ] Sell NO shares decreases supply
- [ ] Price calculated correctly
- [ ] 1% fee charged on sell
- [ ] Cannot sell more than owned
- [ ] Cannot sell from resolved market

#### ✅ Resolve Market
- [ ] Only creator can resolve
- [ ] Cannot resolve before time
- [ ] Cannot resolve twice
- [ ] Decrements active market count

#### ✅ Claim Winnings
- [ ] Can claim winning shares
- [ ] Cannot claim before resolution
- [ ] Cannot claim losing shares
- [ ] Shares cleared after claim

### Frontend Tests

#### ✅ Home Page
- [ ] Markets display correctly
- [ ] Filters work (All/Active/Resolved)
- [ ] Percentages calculate correctly
- [ ] Volume displays correctly
- [ ] Time remaining shows correctly
- [ ] Cards link to trade pages

#### ✅ Create Page
- [ ] Wallet connection required
- [ ] Question input validates length
- [ ] Banned words show red border
- [ ] Error messages display
- [ ] Character count updates
- [ ] Submit disabled when invalid
- [ ] Success redirects to home

#### ✅ Trade Page
- [ ] Market data loads
- [ ] Bonding curve displays
- [ ] YES/NO tabs work
- [ ] Amount input works
- [ ] Cost calculates correctly
- [ ] Buy button functional
- [ ] User position displays

#### ✅ Dashboard
- [ ] Shows user's markets
- [ ] Shows user's positions
- [ ] Resolve buttons appear
- [ ] Fees collected displayed
- [ ] Claim button functional

#### ✅ Wallet Integration
- [ ] Phantom connects
- [ ] Solflare connects
- [ ] Address displays
- [ ] Disconnect works
- [ ] Auto-reconnect works

## Test Scenarios

### Scenario 1: Happy Path

```bash
# User creates valid market
1. Connect wallet
2. Go to /create
3. Enter: "Will SOL reach $500 in 2025?"
4. Description: "Market resolves on Dec 31, 2025"
5. Resolution: 1 Month
6. Submit → Success ✅

# User trades
7. Go to market page
8. Buy 10 YES shares
9. Check position updated
10. Check creator got fee

# Creator resolves
11. Wait for resolution time
12. Go to dashboard
13. Click "Resolve YES"
14. Market marked resolved

# User claims
15. Go to dashboard
16. Click "Claim Winnings"
17. Receive payout
```

### Scenario 2: Banned Words

```bash
# Test each banned word
For each word in BANNED_WORDS:
1. Go to /create
2. Enter question with banned word
3. Verify red border shown
4. Verify error message shown
5. Verify submit disabled
```

### Scenario 3: Rate Limiting

```bash
# Create 5 markets
1-5. Create valid markets → Success ✅

# Try to create 6th
6. Create another market → Error ❌
   "You have too many active markets (max 5)"
```

### Scenario 4: Bonding Curve

```bash
# Buy shares sequentially
1. Note initial price (P1)
2. Buy 10 shares
3. Note new price (P2)
4. Verify P2 > P1
5. Buy 10 more shares
6. Note price (P3)
7. Verify P3 > P2
```

## Automated Tests

### Unit Tests (Future)

Create `tests/funmarket-pump.ts`:

```typescript
describe("funmarket-pump", () => {
  it("Creates market with valid data", async () => {
    // Test market creation
  });

  it("Blocks banned words", async () => {
    // Test banned word filter
  });

  it("Enforces rate limiting", async () => {
    // Test max 5 markets
  });

  it("Calculates bonding curve correctly", async () => {
    // Test price increases
  });
});
```

Run with:
```bash
anchor test
```

## Load Testing

### Stress Test Market Creation

```bash
# Create many markets quickly
for i in {1..5}; do
  anchor run create-market -- "Market $i"
done
```

### Stress Test Trading

```bash
# Many buys in sequence
for i in {1..100}; do
  anchor run buy-shares -- 1
done
```

## Security Tests

### ✅ Access Control
- [ ] Non-creator cannot resolve market
- [ ] Cannot claim others' winnings
- [ ] Cannot manipulate other positions

### ✅ Input Validation
- [ ] All string inputs sanitized
- [ ] All numeric inputs bounded
- [ ] All time inputs validated

### ✅ Overflow Protection
- [ ] Large share amounts handled
- [ ] Fee calculation safe
- [ ] Supply updates safe

## Performance Tests

### Response Times
- [ ] Market creation <2s
- [ ] Trade execution <2s
- [ ] Page loads <1s
- [ ] Wallet connection <1s

### Gas Usage
- [ ] Create market: ~0.002 SOL
- [ ] Buy shares: ~0.001 SOL
- [ ] Resolve: ~0.001 SOL
- [ ] Claim: ~0.001 SOL

## Browser Compatibility

Test in:
- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Brave
- [ ] Mobile Safari
- [ ] Mobile Chrome

## Test Data

### Valid Questions
```
"Will SOL reach $500 in 2025?"
"Will Bitcoin ETF approval happen this year?"
"Will Ethereum merge to PoS succeed?"
"Will Trump win 2024 election?"
```

### Invalid Questions (Banned Words)
```
"Will someone kill the president?" → ❌
"Will child abuse rates drop?" → ❌
"Will suicide rates increase?" → ❌
"Is porn legal in all states?" → ❌
```

## Reporting Bugs

When reporting issues, include:
1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Screenshots
5. Browser console errors
6. Transaction signature (if applicable)
7. Wallet address
8. Program ID

## Coverage Goals

- Smart contract: >80%
- Frontend components: >70%
- Utils/helpers: >90%

## Continuous Testing

Before each deployment:
1. Run all manual tests
2. Test on devnet
3. Test all banned words
4. Test rate limiting
5. Verify all calculations
6. Check gas costs

---

**Test thoroughly before mainnet!** 🧪
