# RapidAPI Sports Provider Setup

## Current Provider: SportAPI7

We use **SportAPI7** (`sportapi7.p.rapidapi.com`) as the primary sports data provider for match search. This is a multi-sport API that covers soccer, basketball, tennis, MMA, and American football through a single subscription.

> **Note:** The previous API-Sports provider (api-football-v1, api-basketball, etc.) required separate subscriptions per sport and had pending approval issues. SportAPI7 replaces it for search. The legacy `apiSportsProvider.ts` is still used by `/api/sports/refresh-one` and `/api/sports/create-event` for live score refresh — it will be migrated in a future pass.

## Required Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `RAPIDAPI_KEY` | Yes | — | Your RapidAPI key. If missing, the app falls back to mock data. |
| `SPORTS_DEBUG` | No | `0` | Set to `1` to enable debug logging for provider calls |
| `SPORTS_REFRESH_TOKEN` | No | — | Admin token for server-side refresh polling |

SportAPI7 uses a single host: `sportapi7.p.rapidapi.com` (hardcoded, no env override needed).

## RapidAPI Subscription

Subscribe to **SportAPI7** on RapidAPI:
- URL: https://rapidapi.com/fluis26/api/sportapi7
- Endpoints used:
  - `GET /api/v1/search/multi?q=` — multi-sport search (events + teams)
  - `GET /api/v1/search/teams?q=` — team search (fallback)
  - `GET /api/v1/team/{teamId}/events/next/0` — upcoming events for a team

## Testing

### Search with curl (POST)

```bash
curl -X POST http://localhost:3000/api/sports/search \
  -H "Content-Type: application/json" \
  -d '{"q": "PSG", "sport": "soccer"}'
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
      "provider": "sportapi7",
      "provider_event_id": "sportapi7_soccer_12345",
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

## Rate Limits & Caching

- **Client-side:** Debounced at 500ms, minimum 3 characters before searching.
- **Server-side:** 60-second in-memory TTL cache per `sport:q` pair.
- SportAPI7 free tier: ~100 requests/day. Paid tiers have higher limits.
- The admin refresh endpoint (`/api/sports/refresh-one` with `x-refresh-token`) still uses the legacy API-Sports provider for live score updates. Run via cron every 30-60s during live events.

## Fallback Behavior

If `RAPIDAPI_KEY` is not set:
- `/api/sports/search` returns hardcoded mock matches (PSG, Lakers, Alcaraz, etc.)
- `/api/sports/refresh-one` falls back to the legacy mock provider (random status transitions)
- `/api/sports/create-event` inserts basic data without enrichment

The app works fully in development without a RapidAPI key.

## Legacy: API-Sports Provider

The files below still use the old API-Sports multi-host provider and are NOT yet migrated to SportAPI7:
- `app/src/lib/sportsProviders/apiSportsProvider.ts` — used by refresh-one and create-event
- `app/src/app/api/sports/refresh-one/route.ts`
- `app/src/app/api/sports/create-event/route.ts`

These will be updated once SportAPI7 event-by-ID fetch is confirmed working.

### Legacy env vars (only needed for refresh/create-event enrichment)

| Variable | Default |
|---|---|
| `RAPIDAPI_HOST_FOOTBALL` | `api-football-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_BASKETBALL` | `api-basketball.p.rapidapi.com` |
| `RAPIDAPI_HOST_TENNIS` | `api-tennis-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_MMA` | `api-mma-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_AMERICAN_FOOTBALL` | `api-american-football-v1.p.rapidapi.com` |
