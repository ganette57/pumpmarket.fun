-- =====================================================================
-- Play Mode — Privy identity
-- =====================================================================
-- Lets a Play account be identified by a Privy user (a Google login)
-- instead of by a Solana wallet signature.
--
-- Apply via Supabase SQL Editor or:
--   psql "$DATABASE_URL" -f supabase/migrations/20260813_play_privy_identity.sql
--
-- ---------------------------------------------------------------------
-- WHAT THIS DOES NOT DO
-- ---------------------------------------------------------------------
-- No table is created, dropped or altered. No column is added: the
-- play_accounts.privy_user_id column and its unique partial index have
-- existed unused since 20260721_play_mode_core.sql, which called them
-- "reserved for the future migration". This is that migration, and it
-- adds exactly one function.
--
-- No existing function is redefined. Nothing here touches a balance, a
-- trade, a season or a ledger row. Legacy wallet accounts are not
-- migrated, rewritten, merged or renumbered — play_ensure_account()
-- continues to serve them unchanged.
--
-- Additive and idempotent: safe to re-run.
--
-- ---------------------------------------------------------------------
-- IDENTITY MODEL
-- ---------------------------------------------------------------------
-- play_accounts.id (uuid) is, and remains, THE Play identity. Every
-- play_trades / play_ledger row already references it. A wallet address
-- and a Privy DID are both just ways of FINDING that row:
--
--   legacy user  ->  wallet signature  ->  wallet_address  -> account
--   Google user  ->  verified Privy token -> privy_user_id -> account
--
-- Because the DID is the lookup key for a Privy user, the embedded
-- Solana wallet can be lost, recovered or recreated without the user
-- losing a cent of their bankroll.
-- =====================================================================


-- =====================================================================
-- play_ensure_account_for_privy(privy_user_id, wallet)
-- =====================================================================
-- Returns the Play account for a VERIFIED Privy user, creating it on
-- first sight.
--
-- CALLER CONTRACT — read this before using it anywhere:
--   Both arguments must come from a Privy access token that the server
--   has already verified, and from the Privy API user object that token
--   resolved to. Neither may come from a request body. This function
--   cannot tell a real DID from an invented one; it trusts its caller
--   completely, exactly as play_ensure_account() trusts that a wallet
--   signature was checked before it was called.
--
-- WALLET PINNING
--   wallet_address is written ONCE, when the account is created, and is
--   never updated afterwards. play_accounts.wallet_address is NOT NULL
--   with a unique index, so the column needs a value; the embedded
--   wallet address at first login is the natural one.
--
--   It is deliberately not kept in sync with the user's current embedded
--   wallet. Chasing the live address would mean an already-issued
--   play_session cookie (which is bound to a wallet string, and lives for
--   7 days) could stop resolving to its own account and silently mint a
--   second one — precisely the lost-bankroll bug this migration exists to
--   prevent. The pinned value is an internal identifier, not a claim
--   about which wallet the user trades Real from today.
-- =====================================================================

create or replace function public.play_ensure_account_for_privy(
  privy_user_id_in text,
  wallet_in        text
)
returns public.play_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  did text;
  w   text;
  acc public.play_accounts;
begin
  did := nullif(btrim(coalesce(privy_user_id_in, '')), '');
  if did is null then
    raise exception 'play: privy_user_id is required'
      using errcode = '22023';
  end if;

  -- 1. Returning user. The DID is the identity, so this branch is what
  --    makes a re-created embedded wallet harmless: the address may have
  --    changed, the account is still the same row with the same balance.
  select * into acc
    from public.play_accounts
   where privy_user_id = did;
  if found then
    return acc;
  end if;

  w := public.play_normalize_wallet(wallet_in);
  if w is null then
    raise exception 'play: wallet_address is required'
      using errcode = '22023';
  end if;
  if char_length(w) not between 32 and 64 then
    raise exception 'play: wallet_address is not a plausible base58 address'
      using errcode = '22023';
  end if;

  -- 2. An UNCLAIMED account already sits on this exact address.
  --
  --    This is not a merge of two different identities. The address is
  --    the user's own Privy embedded wallet — Privy generated the
  --    keypair, and the caller read the address from Privy's API, so it
  --    cannot be an address the user merely named. The only way a row
  --    exists here already is that the very same keypair signed into Play
  --    as an external wallet before Privy login existed. Same key, same
  --    person, same bankroll.
  --
  --    `privy_user_id is null` is the safety rail: an account already
  --    claimed by another Privy user is never taken over, it falls
  --    through to the error at the bottom.
  update public.play_accounts
     set privy_user_id = did,
         updated_at    = now()
   where wallet_address = w
     and privy_user_id is null
  returning * into acc;
  if found then
    return acc;
  end if;

  -- 3. Brand new Play account.
  --    ON CONFLICT DO NOTHING rather than DO UPDATE: a conflict here
  --    means the address belongs to somebody else, which must not
  --    silently rebind their row.
  insert into public.play_accounts (wallet_address, privy_user_id)
  values (w, did)
  on conflict do nothing
  returning * into acc;
  if found then
    return acc;
  end if;

  -- 4. Two concurrent first logins for the same DID: the other one won,
  --    so its row is now visible. Return it rather than failing a login
  --    over a race.
  select * into acc
    from public.play_accounts
   where privy_user_id = did;
  if found then
    return acc;
  end if;

  -- Nothing left but a genuine collision: this address is already a
  -- different Privy user's account.
  raise exception 'play: wallet % is already linked to another Play account', w
    using errcode = '23505';
end $$;

-- No REVOKE here, matching every other Play function in
-- 20260721_play_mode_core.sql. Reachability is controlled at the TABLE
-- level: play_accounts has RLS on with no anon policy and its grants
-- revoked from anon/authenticated, so the only client that can get
-- anything out of this SECURITY DEFINER function is the service role —
-- which is the only one lib/playEngine.ts ever uses. Revoking EXECUTE
-- from PUBLIC here would take service_role's inherited grant with it and
-- break every Privy login.
comment on function public.play_ensure_account_for_privy(text, text) is
  'Resolves the Play account for a VERIFIED Privy user, keyed on the DID. '
  'Caller MUST have verified the Privy access token and read the wallet '
  'address from Privy''s API — never from a request body.';
