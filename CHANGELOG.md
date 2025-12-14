# Changelog

All notable changes to Funmarket.pump will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for V1 (Q2 2025)
- Chainlink Data Feeds integration
- Automated market resolution for price feeds
- Email notifications
- Market search and advanced filtering
- Market categories/tags

### Planned for V2 (Q3 2025)
- UMA Optimistic Oracle integration
- Reality.eth integration
- Multi-outcome markets (>2 options)
- Dispute mechanism
- Social features (comments, likes)

### Planned for V3 (Q4 2025)
- Live streaming integration
- Mobile app (React Native)
- Advanced analytics dashboard
- Developer API
- Liquidity pools

## [0.1.0] - 2025-11-08

### Added - MVP Release 🎉

#### Smart Contract (Solana/Anchor)
- Binary YES/NO prediction markets
- Bonding curve pricing mechanism (`price = base + supply/100k`)
- 1% creator fees on all trades (buy & sell)
- Strict banned words filter (20 words) enforced at contract level
- Rate limiting (max 5 active markets per wallet via PDA counter)
- Manual market resolution by creator
- Buy/sell shares with automatic pricing
- Claim winnings after market resolution
- User position tracking
- Market volume and fee tracking
- Chainlink oracle integration points (ready for V1)

#### Frontend (Next.js + React + TypeScript)
- **Pages:**
  - Home page with market browser and filters (All/Active/Resolved)
  - Create page with real-time banned words validation
  - Trade page with bonding curve visualization (Chart.js)
  - Dashboard for creators and traders
- **Components:**
  - Wallet integration (Phantom, Solflare)
  - Market cards with YES/NO percentages
  - Bonding curve chart visualization
  - Real-time validation with error messages
- **Utils:**
  - Solana/web3 integration utilities
  - Banned words filter (matching contract)
  - Bonding curve calculations
  - PDA derivation helpers

#### Security Features
- Contract-level banned words enforcement
- UI-level real-time validation
- Rate limiting to prevent spam
- Access control (creator-only resolution)
- Input validation (length, content, time)
- Economic security via bonding curve

#### Documentation
- Complete README with overview and setup
- Step-by-step DEPLOYMENT guide
- 5-minute QUICKSTART guide
- Comprehensive TESTING guide
- Detailed FEATURES documentation
- PROJECT_SUMMARY for overview
- MIT LICENSE with disclaimers

#### Developer Experience
- Anchor test suite with 8+ test cases
- Helper scripts (deploy, test-banned-words, init-user)
- Environment configuration examples
- TypeScript configuration
- Tailwind CSS with custom theme
- Code comments and documentation

#### Design/UX
- Dark mode UI (Polymarket inspired)
- Flashy animations (PumpFun inspired)
- Responsive design (mobile-friendly)
- Custom color scheme (pump-green, pump-red)
- Smooth transitions and hover effects
- Real-time feedback

### Technical Specifications
- Solana Devnet deployment
- Anchor Framework 0.29.0
- Next.js 14 (App Router)
- React 18
- TypeScript 5
- Tailwind CSS 3
- Chart.js 4
- Solana Web3.js 1.87+

### Known Limitations (MVP)
- Manual resolution only (Chainlink coming in V1)
- Simplified payout mechanism (1 SOL per winning share)
- Binary outcomes only (multi-outcome in V2)
- Devnet only (mainnet requires audit)
- No social features (comments, likes) yet
- No mobile app (planned for V3)

### Security Audit Status
- ⚠️ Not audited - DO NOT use in production
- Devnet testing only
- Community review welcome

### Deployment Cost
- Smart Contract: ~5 devnet SOL (FREE)
- Frontend: Vercel free tier (FREE)
- **Total: $0**

---

## Version History

- **0.1.0** (2025-11-08) - MVP Release
  - Initial release with core features
  - Smart contract + frontend complete
  - Comprehensive documentation
  - Ready for devnet deployment

---

## Upgrade Guide

### From 0.1.0 to V1 (when released)

**Smart Contract:**
1. Program will be upgraded (same address)
2. New instruction: `resolve_with_chainlink`
3. Existing markets unaffected
4. New markets can use Chainlink

**Frontend:**
1. Update dependencies: `npm install`
2. New features: Oracle selection in Create page
3. Auto-resolution for price feed markets

**Breaking Changes:**
- None planned (backward compatible)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:
- Reporting bugs
- Suggesting features
- Submitting pull requests
- Code style
- Testing requirements

---

## Support

- **Issues:** https://github.com/yourusername/funmarket.pump/issues
- **Discussions:** https://github.com/yourusername/funmarket.pump/discussions
- **Documentation:** See README.md

---

**Note:** Versions are for devnet testing. Mainnet deployment requires security audit.
