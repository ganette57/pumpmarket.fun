# Privy integration

Google login, an embedded Solana wallet, and one wallet abstraction for
Real trading.

## What changed, in one picture

```
                       ┌─────────────────────────┐
                       │  FUNMARKET SOLANA WALLET│   useFunMarketWallet()
                       └───────────┬─────────────┘
                     ┌─────────────┴─────────────┐
             Privy embedded                  external
          (Google user, no extension)   (Phantom / Solflare,
                                         via wallet adapter)
```

Everything that signs a Real transaction — the trade page, FeedTradeSheet,
Live, Crypto Daily, create, dashboard, contest, admin — now asks
`useFunMarketWallet()` for a `publicKey` and a `signTransaction`. None of
them knows which implementation answered.

**The Anchor program did not change.** It still receives a Solana public
key, a signed legacy `@solana/web3.js` transaction, and SOL. No USDC, no
new instruction, no new account.

## Provider order

```
ModeProvider
└── PrivyAppProvider          ← PrivyProvider + PrivyIdentityBridge
    └── WalletContextProvider ← ConnectionProvider / WalletProvider / modal
        └── FunMarketWalletProvider
            └── PlaySessionProvider
                └── MarketSnapshotProvider → AppShell
```

Privy is outermost of the wallet providers because `FunMarketWalletProvider`
reads both systems. `PlaySessionProvider` is innermost because its identity
can come from either.

## Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | client + server | for Google login | Privy app id |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | client | no | Only if you use Privy app clients per environment |
| `PRIVY_APP_SECRET` | **server only** | for Google login | Authenticates as the app to Privy's API |
| `PRIVY_VERIFICATION_KEY` | **server only** | no | Verify tokens locally instead of fetching JWKS |

With `NEXT_PUBLIC_PRIVY_APP_ID` unset the app still runs: Google login is
not offered and everything falls back to the Solana wallet adapter exactly
as before. That is a supported configuration, not a broken one.

`PRIVY_APP_SECRET` must never gain a `NEXT_PUBLIC_` prefix. It is the app's
credential, not the user's.

## Manual Privy Dashboard setup

None of this can be done from the repo.

1. **Create the app** → copy the App ID into `NEXT_PUBLIC_PRIVY_APP_ID` and
   the App Secret into `PRIVY_APP_SECRET`.
2. **Login methods** → enable **Google**. Enable **Solana wallets** if you
   want crypto users to be able to connect through Privy as well as through
   the app's own wallet-adapter modal.
3. **Embedded wallets** → enable **Solana**. The app requests
   `createOnLogin: 'all-users'`, but the dashboard must permit Solana
   embedded wallets at all.
4. **Allowed domains** → add every origin the app runs on, including the
   local dev port. Privy rejects requests from unlisted origins.
5. **Funding (optional)** → enable the funding methods you want under
   payments/on-ramp. **Until this is configured, "Add funds" falls back to
   the "Receive SOL" address panel**, which always works. Nothing breaks if
   you skip this step.

## Play identity

`play_accounts` was built for this. From the original Play migration:

> `id` is a UUID SURROGATE key on purpose. `wallet_address` is a secondary
> unique identifier and `privy_user_id` is reserved for the future
> migration.

So there is no schema change — `privy_user_id` and its unique partial index
have existed unused since day one. The new migration
(`20260813_play_privy_identity.sql`) adds exactly one function,
`play_ensure_account_for_privy(privy_user_id, wallet)`, and nothing else.

```
legacy user  →  wallet signature      →  wallet_address  →  play_accounts.id
Google user  →  verified Privy token  →  privy_user_id   →  play_accounts.id
```

Because the DID is the lookup key, a re-created embedded wallet resolves to
the same account and the same balance.

### Wallet pinning

A Privy account's `wallet_address` is written once, at creation, and never
updated. The column is `NOT NULL` and unique so it needs *a* value, and the
embedded address at first login is the natural one — but it is an internal
identifier, not a claim about which wallet the user trades Real from today.

Keeping it in sync with the live embedded wallet would mean an
already-issued `play_session` cookie (bound to a wallet string, 7-day life)
could stop resolving to its own account and silently mint a second one.
That is the lost-bankroll bug the DID lookup exists to prevent.

### What is deliberately NOT done

No automatic merge of a Google account with a pre-existing wallet account.
The one adjacent case the migration does handle is an **unclaimed** account
sitting on the *same address as the user's own embedded wallet* — same
keypair, same person — and it only ever touches rows where
`privy_user_id IS NULL`.

## Security

- The client sends **one** thing: a Privy access token, as a bearer header.
- The server verifies it with `@privy-io/node`, then reads the user's
  embedded wallet address back **from Privy's API**. A DID or an address in
  a request body is never trusted — that would let anyone claim any Play
  account by naming its wallet.
- The Play session remains the same httpOnly, HMAC-signed cookie. Every
  Play route is unchanged and cannot tell which door the user came through.
- Real transactions are still signed by whichever wallet holds the funds.
- No private key is ever exported or handled. No server custody of funds:
  "Add funds" sends SOL to the user's own embedded wallet.

## Dependency notes

Three dependency changes were forced by Privy v3, all documented at their
call sites:

1. **`@solana/wallet-adapter-wallets` → `@solana/wallet-adapter-phantom` +
   `@solana/wallet-adapter-solflare`.** The aggregate package pulls in
   Trezor, which pins `@solana-program/system@^0.7`; Privy needs `>=0.8`.
   Only one file imported it, and it imported exactly those two adapters.

2. **`lucide-react` 0.294 → ^0.554.** Next 14 unconditionally applies its
   barrel-import optimization to `lucide-react` and resolves the rewritten
   request from the project root, reaching past npm's correct nesting of
   Privy's own newer copy. All 57 icons the app uses exist in 0.554, and
   the repo root already used 0.562.

3. **npm `overrides` for `@privy-io/node`'s optional `@solana/kit` peer.**
   It wants `^5`, `@privy-io/react-auth` and the `@solana-program/*`
   packages want `^7`. Scoped to that one package; we never call Privy's
   server-side Solana helpers.

`next.config.js` also stubs three optional Privy peers the app does not use
(Farcaster mini-apps, Abstract Global Wallet, ERC-4337 bundlers) with
`resolve.alias: false`, and externalizes the `@solana/kit` family on the
server build per Privy's v3 migration guide.
