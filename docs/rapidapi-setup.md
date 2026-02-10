# RapidAPI Sports Provider Setup

## Current Provider: Odds Feed

We use **Odds Feed** (`odds-feed.p.rapidapi.com`) as the primary sports data provider for match listing and linking. This is a multi-sport API that covers soccer, basketball, tennis, MMA, and American football.

> **Note:** Odds Feed is temporary — we plan to evaluate API-Football and other providers in the future.

> **Strategy:** The server fetches upcoming fixtures (7 days) for a sport in one batch, caches the result for 15 minutes, and serves it to the UI. The user browses a scrollable match list and clicks to select a match. No keystroke-based search — one server call per sport per cache window.

## Required Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `RAPIDAPI_KEY` | Yes | — | Your RapidAPI key. If missing, the app falls back to mock data. |
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
3. Server calls Odds Feed for 7 days of events (1 API call per day, cached 15 min)
4. UI shows scrollable list with client-side text filter (no extra API calls)
5. User clicks a match → auto-fills: home team, away team, start time, end time, provider event ID
6. User writes any question and creates the market
7. If no match selected, user can still create manually (provider = "manual")

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
      "end_time": "2026-02-15T22:15:00.000Z",
      "status": "scheduled",
      "label": "Arsenal vs Chelsea",
      "raw": { ... }
    }
  ]
}
```

## Caching

- **Provider-level:** 15 min in-memory TTL cache keyed by `sport + base_date + days`.
- **Route-level:** 10 min in-memory TTL cache keyed by `sport + base_date + q`.
- **Client-side filter:** Purely local, zero API calls. Filters the already-loaded list by substring.

## Fallback Behavior

If `RAPIDAPI_KEY` is not set:
- `/api/sports/search` returns mock matches spread across 7 days (19 fixtures across all sports)
- `/api/sports/refresh-one` falls back to the legacy mock provider
- `/api/sports/create-event` inserts basic data without enrichment

The app works fully in development without a RapidAPI key.

## Provider Field Values

| Value | Meaning |
|---|---|
| `odds-feed` | Match linked to Odds Feed provider event |
| `manual` | Market created without provider linking |
| `mock` | Mock data (dev only, no API key) |

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
