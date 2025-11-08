# Contributing to Funmarket.pump

First off, thank you for considering contributing to Funmarket.pump! 🎉

We're building the future of decentralized prediction markets on Solana, and we welcome contributions from developers of all skill levels.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Message Format](#commit-message-format)

---

## Code of Conduct

### Our Standards

- **Be respectful** - Treat everyone with respect
- **Be constructive** - Provide helpful feedback
- **Keep it legal** - No illegal content or activity
- **Stay professional** - Despite the "degen" branding, maintain professionalism

### Content Policy

Remember: **We're thugs, not criminals.**

DO NOT contribute:
- Illegal content
- Violence or threats
- NSFW material
- Hate speech
- Content targeting minors

If you see violations, report them immediately.

---

## How Can I Contribute?

### 🐛 Reporting Bugs

**Before submitting:**
1. Check existing issues
2. Test on latest version
3. Verify it's not a configuration issue

**When submitting, include:**
- Clear, descriptive title
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Environment details:
  - Solana version
  - Anchor version
  - Node version
  - Browser (for frontend)
- Transaction signatures (if applicable)
- Program ID and cluster

**Example:**
```markdown
**Bug:** Market creation fails with valid question

**Steps to Reproduce:**
1. Connect Phantom wallet
2. Go to /create
3. Enter "Will SOL hit $500?"
4. Click submit

**Expected:** Market created successfully
**Actual:** Transaction fails with error X

**Environment:**
- Solana: 1.18.0
- Anchor: 0.29.0
- Browser: Chrome 120
- Cluster: devnet
```

### 💡 Suggesting Features

We love feature ideas! Please:

1. Check if already suggested
2. Describe the problem it solves
3. Propose a solution
4. Consider implementation complexity

**Use this template:**
```markdown
**Feature:** Brief title

**Problem:** What problem does this solve?

**Solution:** How should it work?

**Alternatives:** Other approaches considered?

**Implementation:** Complexity estimate (Low/Medium/High)
```

### 🔧 Contributing Code

**Priority Areas:**
- Chainlink oracle integration
- Additional oracle sources (UMA, Reality.eth)
- UI/UX improvements
- Test coverage
- Documentation
- Bug fixes
- Performance optimization

**Good First Issues:**
- Look for `good-first-issue` label
- Documentation improvements
- UI polish
- Additional tests
- Example scripts

---

## Development Setup

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Install Node
# Recommended: nvm install 18
```

### Clone and Setup

```bash
# Fork the repo on GitHub first, then:
git clone https://github.com/YOUR_USERNAME/funmarket.pump.git
cd funmarket.pump

# Install dependencies
npm install
cd app && npm install && cd ..

# Setup Solana
solana-keygen new --outfile ~/.config/solana/id.json
solana config set --url https://api.devnet.solana.com
solana airdrop 5

# Build
anchor build
```

### Running Tests

```bash
# Smart contract tests
anchor test

# Frontend (not yet implemented)
cd app
npm test

# Banned words validation
./scripts/test-banned-words.sh
```

### Local Development

```bash
# Start local validator
solana-test-validator

# Deploy locally (in another terminal)
anchor deploy --provider.cluster localnet

# Run frontend
cd app
npm run dev
# Open http://localhost:3000
```

---

## Pull Request Process

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

**Branch naming:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `test/` - Tests
- `refactor/` - Code refactoring

### 2. Make Changes

- Write clean, documented code
- Follow coding standards (see below)
- Add tests for new features
- Update documentation

### 3. Test Thoroughly

```bash
# Run all tests
anchor test

# Test banned words
./scripts/test-banned-words.sh

# Build frontend
cd app && npm run build

# Manual testing checklist
# See TESTING.md
```

### 4. Commit

Follow [commit message format](#commit-message-format).

```bash
git add .
git commit -m "feat: Add Chainlink price feed integration"
```

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create PR on GitHub with:
- Clear title
- Description of changes
- Related issues (if any)
- Testing done
- Screenshots (if UI changes)

### 6. Review Process

- Maintainers will review
- Address feedback
- Keep discussion constructive
- Be patient

**PR will be merged when:**
- ✅ All tests pass
- ✅ Code review approved
- ✅ Documentation updated
- ✅ No merge conflicts

---

## Coding Standards

### Rust (Smart Contract)

```rust
// Use descriptive names
pub fn create_market() // Good
pub fn cm() // Bad

// Comment complex logic
// Calculate bonding curve cost
// Formula: cost = integral of (10 * sqrt(x))
let cost = calculate_bonding_curve_cost(supply, amount);

// Handle errors properly
require!(question.len() >= 10, ErrorCode::InvalidQuestionLength);

// Use constants for magic numbers
const MIN_QUESTION_LENGTH: usize = 10;
const MAX_QUESTION_LENGTH: usize = 200;
```

**Style:**
- 4 spaces indentation
- Max 100 chars per line
- `snake_case` for functions/variables
- `PascalCase` for types
- Run `cargo fmt` before committing

### TypeScript (Frontend)

```typescript
// Use TypeScript features
interface Market {
  publicKey: string;
  question: string;
  // ...
}

// Descriptive function names
function calculateBondingCurvePrice(supply: number): number {
  // ...
}

// Use early returns
if (!connected) {
  return <div>Please connect wallet</div>;
}

// Comment non-obvious code
// Bonding curve: price = base + (supply / 100k)
const price = basePrice + (currentSupply / 100000);
```

**Style:**
- 2 spaces indentation
- Max 100 chars per line
- `camelCase` for functions/variables
- `PascalCase` for components/types
- Run `npm run lint` before committing

### General Principles

1. **DRY** - Don't Repeat Yourself
2. **KISS** - Keep It Simple, Stupid
3. **YAGNI** - You Ain't Gonna Need It
4. **Fail Fast** - Validate early, fail clearly
5. **Security First** - Always consider security implications

---

## Testing Guidelines

### Test Coverage Goals

- Smart contract: **>80%**
- Frontend: **>70%**
- Utilities: **>90%**

### Writing Tests

```typescript
describe("feature", () => {
  it("should do expected behavior", async () => {
    // Arrange - Setup
    const market = await setupMarket();

    // Act - Execute
    await market.buy(10);

    // Assert - Verify
    assert.equal(market.supply, 10);
  });

  it("should reject invalid input", async () => {
    try {
      await market.buy(-10);
      assert.fail("Should have thrown");
    } catch (error) {
      assert.include(error, "InvalidAmount");
    }
  });
});
```

### Test Checklist

Before submitting PR:
- [ ] All existing tests pass
- [ ] New tests for new features
- [ ] Edge cases covered
- [ ] Error cases tested
- [ ] Manual testing done (see TESTING.md)

---

## Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Code style (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance

### Examples

```
feat(oracle): Add Chainlink price feed integration

- Implemented ChainlinkResolve instruction
- Added BTC/USD, ETH/USD, SOL/USD feeds
- Updated UI to show oracle options

Closes #42
```

```
fix(ui): Prevent create button double-click

Users could double-click the create button, causing
duplicate transactions. Added loading state.

Fixes #56
```

```
docs: Update deployment guide with troubleshooting

Added common errors and solutions based on community
feedback.
```

### Rules

- Use imperative mood ("Add" not "Added")
- First line max 72 chars
- Body wraps at 72 chars
- Reference issues in footer

---

## Review Checklist

Before requesting review, verify:

### Code Quality
- [ ] Follows coding standards
- [ ] No commented-out code
- [ ] No console.logs (except intentional)
- [ ] Descriptive variable names
- [ ] Comments for complex logic

### Testing
- [ ] Tests written and passing
- [ ] Edge cases covered
- [ ] Manual testing done

### Documentation
- [ ] Code comments added
- [ ] README updated (if needed)
- [ ] CHANGELOG updated
- [ ] API docs updated (if applicable)

### Security
- [ ] Input validation
- [ ] No banned words bypass
- [ ] Access control verified
- [ ] No security vulnerabilities

### Performance
- [ ] No unnecessary computations
- [ ] Efficient algorithms
- [ ] Rent-optimized (Solana)

---

## Recognition

Contributors will be:
- Listed in README
- Mentioned in release notes
- Credited in CHANGELOG
- Given contributor badge

Top contributors may be invited to:
- Maintainer team
- Early access to features
- Community leadership roles

---

## Questions?

- **General:** Open a Discussion
- **Bugs:** Open an Issue
- **Security:** Email security@funmarket.pump (DO NOT open public issue)

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Funmarket.pump! 🚀**

Built with ⚡ by degens, for degens.
