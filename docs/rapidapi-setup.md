# RapidAPI (API-Sports) Setup

## Required Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `RAPIDAPI_KEY` | Yes | — | Your RapidAPI key. If missing, the app falls back to mock data. |
| `RAPIDAPI_HOST_FOOTBALL` | No | `api-football-v1.p.rapidapi.com` | RapidAPI host for soccer/football |
| `RAPIDAPI_HOST_BASKETBALL` | No | `api-basketball.p.rapidapi.com` | RapidAPI host for basketball |
| `RAPIDAPI_HOST_TENNIS` | No | `api-tennis-v1.p.rapidapi.com` | RapidAPI host for tennis |
| `RAPIDAPI_HOST_MMA` | No | `api-mma-v1.p.rapidapi.com` | RapidAPI host for MMA |
| `RAPIDAPI_HOST_AMERICAN_FOOTBALL` | No | `api-american-football-v1.p.rapidapi.com` | RapidAPI host for American football |
| `SPORTS_DEBUG` | No | `0` | Set to `1` to enable debug logging for API-Sports calls |
| `SPORTS_REFRESH_TOKEN` | No | — | Admin token for server-side refresh polling |

## RapidAPI Subscriptions

Subscribe to these APIs on RapidAPI:

1. **API-Football** — `api-football-v1.p.rapidapi.com`
   - Endpoints used: `/v3/teams?search=`, `/v3/fixtures?team=&from=&to=`, `/v3/fixtures?id=`
2. **API-Basketball** — `api-basketball.p.rapidapi.com`
   - Endpoints used: `/teams?search=`, `/games?team=&date=`, `/games?id=`
3. **API-Tennis** — `api-tennis-v1.p.rapidapi.com`
   - Endpoints used: `/games?date=`, `/games?id=`
4. **API-MMA** — `api-mma-v1.p.rapidapi.com`
   - Endpoints used: `/fights?date=`, `/fights?status=`, `/fights?id=`
5. **API-American-Football** — `api-american-football-v1.p.rapidapi.com`
   - Endpoints used: `/teams?search=`, `/games?team=&date=`, `/games?id=`

## Rate Limits

Most API-Sports plans have daily request limits (100-500/day on free tiers, higher on paid).

Recommendations:
- Use the admin refresh endpoint (`/api/sports/refresh-one` with `x-refresh-token`) via a cron job (every 30-60s during live events)
- Client-side refresh calls return cached Supabase rows without hitting the provider
- Search results are not cached — each search hits the API. Consider adding a short TTL cache if search volume is high.

## Fallback Behavior

If `RAPIDAPI_KEY` is not set:
- `/api/sports/search` returns hardcoded mock matches (PSG, Lakers, Alcaraz, etc.)
- `/api/sports/refresh-one` falls back to the legacy mock provider (random status transitions)
- `/api/sports/create-event` inserts basic data without enrichment

This means the app works fully in development without a RapidAPI key.
