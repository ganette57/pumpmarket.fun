# RapidAPI Sports Provider Setup

## Architecture: Fixtures Provider Adapter

The fixture browsing system uses a **provider adapter** (`fixturesProvider.ts`) that selects the backend based on the `FIXTURES_PROVIDER` env var:

| `FIXTURES_PROVIDER` | Behavior |
|---|---|
| `odds_feed` | Live data from Odds Feed (RapidAPI) |
| `mock` | Built-in mock fixtures (19 matches across 5 sports) |
| *(not set)* | Auto-detect: uses `odds_feed` if `RAPIDAPI_KEY` is present, otherwise `mock` |

> **T-2 Auto-End Rule:** All fixture `end_time` values are set to **match end minus 2 minutes**. This means trading auto-locks 2 minutes before the estimated match end.

### File Layout

| File | Role |
|---|---|
| `lib/sportsProviders/fixturesProvider.ts` | Provider adapter — the ONLY import for fixture browsing |
| `lib/sportsProviders/oddsFeedProvider.ts` | Odds Feed implementation (called by fixturesProvider) |
| `app/api/sports/search/route.ts` | API route — imports from fixturesProvider |
| `lib/sportsProviders/apiSportsProvider.ts` | Legacy — used by refresh-one and create-event only |

## Current Live Provider: Odds Feed

We use **Odds Feed** (`odds-feed.p.rapidapi.com`) as the primary sports data provider for match listing and linking. This is a multi-sport API that covers soccer, basketball, tennis, MMA, and American football.

> **Note:** Odds Feed is temporary — we plan to evaluate API-Football and other providers in the future.

> **Strategy:** The server fetches upcoming fixtures (7 days) for a sport in one batch, caches the result for 15 minutes, and serves it to the UI. The user browses a scrollable match list and clicks to select a match. No keystroke-based search — one server call per sport per cache window.

## Required Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `RAPIDAPI_KEY` | Yes | — | Your RapidAPI key. If missing, the app falls back to mock data. |
| `FIXTURES_PROVIDER` | No | auto-detect | `odds_feed` or `mock`. Auto-detects from RAPIDAPI_KEY if not set. |
| `SPORTS_DEBUG` | No | `0` | Set to `1` to enable debug logging for provider calls |
| `SPORTS_REFRESH_TOKEN` | No | — | Admin token for server-side refresh polling |

Odds Feed uses a single host: `odds-feed.p.rapidapi.com` (hardcoded, no env override needed).

## RapidAPI Subscription

Subscribe to **Odds Feed** on RapidAPI:
- URL: https://rapidapi.com/tipsters/api/odds-feed
- Free tier: 500 requests/month
- Endpoints used:
  - `GET /api/v1/events/list?sport_id={id}&day={YYYY-MM-DD}&page=1` — events for a sport on a date

### Response Shape

```json
{
  "data": [
    {
      "id": 12345,
      "sport": { "id": 1, "name": "Football", "slug": "football" },
      "tournament": { "id": 100, "name": "Premier League" },
      "category": { "id": 50, "name": "England" },
      "team_home": { "name": "Arsenal" },
      "team_away": { "name": "Chelsea" },
      "status": "SCHEDULED",
      "start_at": "2026-02-15 20:00:00"
    }
  ]
}
```

### Sport ID Mapping

| Our internal name | Odds Feed sport_id |
|---|---|
| soccer | 1 |
| tennis | 2 |
| basketball | 3 |
| mma | 4 |
| american_football | 12 |

## How It Works

1. User selects a sport category and enters match mode
2. User clicks "Load matches (next 7 days)" → ONE POST to `/api/sports/search`
3. `fixturesProvider` selects backend (mock or odds_feed) based on env config
4. If odds_feed: calls Odds Feed for 7 days of events (1 API call per day, cached 15 min), applies T-2 to end_time
5. If mock: returns 19 built-in fixtures with T-2 already applied
6. UI shows scrollable list with client-side text filter (no extra API calls)
7. User clicks a match → auto-fills: home team, away team, start time, end time (T-2), provider event ID, provider name
8. User writes any question and creates the market
9. If no match selected, user can still create manually (provider = "manual")

## API Route: `/api/sports/search`

### POST (primary)

```bash
curl -X POST http://localhost:3000/api/sports/search \
  -H "Content-Type: application/json" \
  -d '{"sport": "soccer"}'
```

Optional parameters:
- `base_date` (YYYY-MM-DD or ISO) — start of 7-day window, default today
- `q` — optional text filter (applied server-side, min 3 chars)

### GET (legacy)

```bash
curl "http://localhost:3000/api/sports/search?sport=soccer"
```

### Response

```json
{
  "matches": [
    {
      "provider": "odds-feed",
      "provider_event_id": "oddsfeed_soccer_12345",
      "sport": "soccer",
      "league": "Premier League",
      "home_team": "Arsenal",
      "away_team": "Chelsea",
      "start_time": "2026-02-15T20:00:00.000Z",
      "end_time": "2026-02-15T22:13:00.000Z",
      "status": "scheduled",
      "label": "Arsenal vs Chelsea",
      "raw": { ... }
    }
  ]
}
```

> Note: `end_time` is estimated match end minus 2 minutes (T-2 rule).

## Caching

- **Provider-level (oddsFeedProvider):** 15 min in-memory TTL cache keyed by `sport + base_date + days`.
- **Route-level (search route):** 10 min in-memory TTL cache keyed by `sport + base_date + q`.
- **Client-side filter:** Purely local, zero API calls. Filters the already-loaded list by substring.

## Fallback Behavior

If `RAPIDAPI_KEY` is not set (or `FIXTURES_PROVIDER=mock`):
- `/api/sports/search` returns mock matches spread across 7 days (19 fixtures across all sports)
- `/api/sports/refresh-one` falls back to the legacy mock provider
- `/api/sports/create-event` inserts basic data without enrichment

The app works fully in development without a RapidAPI key.

## Provider Field Values

| Value | Meaning |
|---|---|
| `odds-feed` | Match linked to Odds Feed provider event |
| `mock-fixtures` | Mock data from fixturesProvider (dev only, no API key) |
| `manual` | Market created without provider linking |

## Legacy: API-Sports Provider

The files below still use the old API-Sports multi-host provider and are NOT touched:
- `app/src/lib/sportsProviders/apiSportsProvider.ts` — used by refresh-one and create-event
- `app/src/app/api/sports/refresh-one/route.ts`
- `app/src/app/api/sports/create-event/route.ts`

### Legacy env vars (only needed for refresh/create-event enrichment)

| Variable | Default |
|---|---|
| `RAPIDAPI_HOST_FOOTBALL` | `api-football-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_BASKETBALL` | `api-basketball.p.rapidapi.com` |
| `RAPIDAPI_HOST_TENNIS` | `api-tennis-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_MMA` | `api-mma-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_AMERICAN_FOOTBALL` | `api-american-football-v1.p.rapidapi.com` |
