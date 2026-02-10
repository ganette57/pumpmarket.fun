# RapidAPI Sports Provider Setup

## Current Provider: Odds Feed

We use **Odds Feed** (`odds-feed.p.rapidapi.com`) as the primary sports data provider for match linking. This is a multi-sport API that covers soccer, basketball, tennis, MMA, and American football through a single subscription.

> **Strategy:** Users create their market manually (sport, teams, dates), then optionally click "Find match in provider" to link to a provider event via a single API call. This avoids keystroke-based live search and stays within the 500 req/month free tier.

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
  - `GET /v1/events/list?sport_id={id}&day={YYYY-MM-DD}&page=1` — events for a sport on a date

### Sport ID Mapping

| Our internal name | Odds Feed sport_id |
|---|---|
| soccer | 1 |
| tennis | 2 |
| basketball | 3 |
| mma | 4 |
| american_football | 12 |

## How It Works

1. User fills in sport type, home team, away team, and match date on the Create page
2. User clicks "Find match in provider" → ONE POST to `/api/sports/search`
3. Server calls Odds Feed `/v1/events/list` for that sport + date, filters by team name substring
4. Results shown in dropdown → user selects a match → `provider_event_id` stored
5. If no match found, user can still create the market manually (provider = "manual")

## Testing

### Search with curl (POST)

```bash
curl -X POST http://localhost:3000/api/sports/search \
  -H "Content-Type: application/json" \
  -d '{"q": "PSG", "sport": "soccer", "start_time": "2026-02-15T20:00:00.000Z"}'
```

### Search with curl (GET, legacy)

```bash
curl "http://localhost:3000/api/sports/search?q=PSG&sport=soccer"
```

### Expected response shape

```json
{
  "matches": [
    {
      "provider": "odds-feed",
      "provider_event_id": "oddsfeed_soccer_12345",
      "sport": "soccer",
      "league": "Ligue 1",
      "home_team": "PSG",
      "away_team": "Marseille",
      "start_time": "2026-02-15T20:00:00.000Z",
      "end_time": "2026-02-15T22:15:00.000Z",
      "status": "scheduled",
      "label": "PSG vs Marseille",
      "raw": { ... }
    }
  ]
}
```

## Caching

- **Server-side (route):** 60-second in-memory TTL cache per `sport:q:start_time` tuple.
- **Provider-side:** 60-second internal TTL cache to avoid duplicate API calls.
- No client-side debounce needed — search only fires on explicit button click.

## Fallback Behavior

If `RAPIDAPI_KEY` is not set:
- `/api/sports/search` returns hardcoded mock matches (PSG, Lakers, Alcaraz, etc.)
- `/api/sports/refresh-one` falls back to the legacy mock provider (random status transitions)
- `/api/sports/create-event` inserts basic data without enrichment

The app works fully in development without a RapidAPI key.

## Provider Field Values

| Value | Meaning |
|---|---|
| `odds-feed` | Match linked to Odds Feed provider event |
| `manual` | Market created without provider linking |
| `mock` | Mock data (dev only, no API key) |

## Legacy: API-Sports Provider

The files below still use the old API-Sports multi-host provider and are NOT yet migrated:
- `app/src/lib/sportsProviders/apiSportsProvider.ts` — used by refresh-one and create-event
- `app/src/app/api/sports/refresh-one/route.ts`
- `app/src/app/api/sports/create-event/route.ts`

These will be updated once Odds Feed event-by-ID fetch is confirmed working.

### Legacy env vars (only needed for refresh/create-event enrichment)

| Variable | Default |
|---|---|
| `RAPIDAPI_HOST_FOOTBALL` | `api-football-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_BASKETBALL` | `api-basketball.p.rapidapi.com` |
| `RAPIDAPI_HOST_TENNIS` | `api-tennis-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_MMA` | `api-mma-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_AMERICAN_FOOTBALL` | `api-american-football-v1.p.rapidapi.com` |
