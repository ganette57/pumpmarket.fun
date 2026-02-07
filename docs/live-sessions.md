# Live Sessions MVP

## Overview

Live Sessions allow hosts to stream while linking a prediction market for live trading. The feature is UI-driven only — no on-chain lock. Trading logic stays unchanged.

A Live Session is an off-chain Supabase record linking:
- `market_address` (existing on-chain market)
- `host_wallet`
- `stream_url`
- `title`
- `status`: `scheduled | live | locked | ended | resolved | cancelled`

## Supabase Tables

### `live_sessions` (required)

```sql
CREATE TABLE IF NOT EXISTS live_sessions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  title         TEXT NOT NULL,
  market_address TEXT NOT NULL,
  host_wallet   TEXT NOT NULL,
  stream_url    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'live'
                CHECK (status IN ('scheduled','live','locked','ended','resolved','cancelled')),
  thumbnail_url TEXT,
  pinned_outcome INTEGER,
  started_at    TIMESTAMPTZ,
  lock_at       TIMESTAMPTZ,
  end_at        TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ
);

-- Index for listing active sessions
CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions (status);
CREATE INDEX IF NOT EXISTS idx_live_sessions_market ON live_sessions (market_address);
CREATE INDEX IF NOT EXISTS idx_live_sessions_host ON live_sessions (host_wallet);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE live_sessions;
```

### `live_session_events` (optional — for audit log)

```sql
CREATE TABLE IF NOT EXISTS live_session_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  session_id  UUID REFERENCES live_sessions(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  payload     JSONB
);

CREATE INDEX IF NOT EXISTS idx_live_session_events_session ON live_session_events (session_id);
```

### `live_chat_messages` (optional — for live chat)

```sql
CREATE TABLE IF NOT EXISTS live_chat_messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  session_id  UUID REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_wallet TEXT NOT NULL,
  message     TEXT NOT NULL,
  is_host     BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_live_chat_session ON live_chat_messages (session_id, created_at);
```

## Row Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;

-- Anyone can read
CREATE POLICY "public_read_live_sessions"
  ON live_sessions FOR SELECT
  USING (true);

-- Anyone can insert (wallet auth is app-level)
CREATE POLICY "public_insert_live_sessions"
  ON live_sessions FOR INSERT
  WITH CHECK (true);

-- Anyone can update (MVP: ideally restrict to host_wallet via server route)
-- For MVP, allowing public update. See security caveats below.
CREATE POLICY "public_update_live_sessions"
  ON live_sessions FOR UPDATE
  USING (true);
```

### Wallet-based RLS (recommended upgrade)

For production, replace the permissive UPDATE policy with a host-only policy.
This requires passing the wallet address as a Supabase JWT claim or using a
server-side API route with service role key:

```sql
-- Option A: Use a server-side API route (recommended)
-- The frontend calls POST /api/live-sessions/[id]/status with a signed message.
-- The API route verifies the signature, checks host_wallet match, then uses
-- the service role client to update.

-- Option B: Supabase custom claims (if using Supabase Auth)
-- DROP POLICY IF EXISTS "public_update_live_sessions" ON live_sessions;
-- CREATE POLICY "host_only_update"
--   ON live_sessions FOR UPDATE
--   USING (host_wallet = current_setting('request.jwt.claims')::jsonb->>'wallet');
```

### RLS error handling

The client code catches Supabase error code `42501` (permission denied) and
surfaces a clear message: "Permission denied — you may not be the session host".
If you see this error during development, check that:
1. The RLS policies above are applied to the `live_sessions` table.
2. The user's wallet matches `host_wallet` (if using host-only policy).
3. The Supabase anon key has the correct permissions.

## Routes

| Route | Description |
|-------|-------------|
| `/live` | Live feed grid with Live/Feed tabs |
| `/live/new` | Create a new live session (wallet required) |
| `/live/[id]` | Live viewer: stream + trading panel |

## Library Functions (`src/lib/liveSessions.ts`)

| Function | Description |
|----------|-------------|
| `listLiveSessions(filter?)` | List sessions, optionally filtered by status |
| `getLiveSession(id)` | Get a single session by ID |
| `createLiveSession(payload)` | Create a new live session |
| `updateLiveSession(id, patch)` | Update session fields; returns re-fetched row |
| `listActiveLiveSessionsMap()` | Map of market_address → session id for LIVE badges |
| `getActiveLiveSessionForMarket(addr)` | Latest active session for a market |
| `fetchRecentTrades(marketAddr, limit?)` | Last N trades for a market (Live Activity) |
| `subscribeRecentTrades(marketAddr, cb)` | Realtime subscription for new trades |
| `subscribeLiveSession(id, cb)` | Realtime subscription for a single session |
| `subscribeLiveSessionsList(cb)` | Realtime subscription for the full list |

## Host Flow

1. Host connects wallet
2. Navigates to `/live/new`
3. Fills in: title, stream URL, optional thumbnail, linked market
4. Selects "Go Live Now" or "Schedule"
5. Clicks "Start Live Session" → redirected to `/live/[id]`
6. Host sees **Host Controls** panel with status buttons:
   - **Live** → **Locked** → **Ended** → **Resolved**
   - Or **Cancel** at any time

### Status → Column mapping

| Transition | Columns set |
|------------|-------------|
| → `live`   | `lock_at=NULL, end_at=NULL, ended_at=NULL`; if `started_at` is NULL, set `started_at=now()` |
| → `locked` | `lock_at=now()` |
| → `ended`  | `end_at=now(), ended_at=now()` |
| → `resolved` | `end_at=coalesce(end_at, now()), ended_at=coalesce(ended_at, now())` |
| → `cancelled` | `end_at=coalesce(end_at, now()), ended_at=coalesce(ended_at, now())` |

After each update, the row is re-fetched (not optimistic) to avoid stale state.

## UI Lock Behavior

When session status is `locked`, `ended`, `resolved`, or `cancelled`:
- The TradingPanel is hidden (returns `null` when `marketClosed` is true)
- Mobile buy sheet shows "Trading is currently locked" message
- Outcome cards become non-interactive (disabled)
- A status banner is displayed prominently

**This is a UI-only lock. No on-chain enforcement.**

The on-chain market remains tradeable through other interfaces. This is acceptable for MVP. For production, consider adding server-side validation or on-chain lock.

## Desktop Layout

Desktop live mode reuses the existing trade page layout exactly:

```
[ Stream player + market info ] | [ Trading panel (unchanged) ]
```

The left column replaces the odds/outcomes card with:
1. Stream iframe embed (16:9)
2. Title + status banner
3. Compact market info card with outcomes
4. Host controls (if host)
5. Comments section

The right column keeps the TradingPanel as-is.

## Mobile Layout

Mobile-first live experience:
- Stream at top (full-width, 16:9)
- Title + status banner
- Compact market card with outcome percentages
- FAB (floating action button) to open buy sheet
- Bottom sheet modal with amount presets and outcome selector

## Security Caveats (MVP)

1. **No on-chain lock**: Trading lock is UI-only. Users can trade via other frontends.
2. **Client-side updates**: Session status updates are done client-side via Supabase anon key. For production, move to server-side API route with wallet signature verification.
3. **No authentication**: Any connected wallet can create sessions. Add allowlist or admin approval for production.
4. **RLS is permissive**: UPDATE is public. For production, add `host_wallet` check in RLS policy or use service role via API route.

## Supported Stream Platforms

The stream player auto-detects and creates embeds for:
- YouTube (youtube.com/watch, youtu.be, youtube.com/live)
- Twitch (twitch.tv/channel)
- Kick (kick.com/channel)
- Direct iframe URLs (fallback)
