# Sports Provider Setup

## Architecture: Fixtures Provider Adapter

The fixture browsing system uses a **provider adapter** (`fixturesProvider.ts`) that selects the backend based on the `FIXTURES_PROVIDER` env var:

| `FIXTURES_PROVIDER` | Behavior |
|---|---|
| `api_football` | Live data from API-Football (v3.football.api-sports.io) |
| `mock` | Built-in mock fixtures (19 matches across 5 sports) |
| *(not set)* | Auto-detect: uses `api_football` if `APISPORTS_KEY` is present, otherwise `mock` |

> **T-2 Auto-End Rule:** All fixture `end_time` values are set to **match end minus 2 minutes**. This means trading auto-locks 2 minutes before the estimated match end.

### File Layout

| File | Role |
|---|---|
| `lib/sportsProviders/fixturesProvider.ts` | Provider adapter — the ONLY import for fixture browsing |
| `lib/sportsProviders/oddsFeedProvider.ts` | Legacy Odds Feed implementation (NormalizedMatch type lives here) |
| `app/api/sports/search/route.ts` | API route — imports from fixturesProvider |
| `lib/sportsProviders/apiSportsProvider.ts` | Legacy — used by refresh-one and create-event only |

## Current Live Provider: API-Football

We use **API-Football** (`v3.football.api-sports.io`) as the primary sports data provider for match listing and linking. This is a football/soccer API.

> **Note:** API-Football currently supports soccer only. Other sports (basketball, tennis, MMA, American football) fall back to mock data when using the real provider.

> **Strategy:** The server fetches upcoming fixtures (7 days) for a sport in one batch, caches the result for 15 minutes, and serves it to the UI. The user browses a scrollable match list in a modal and clicks to select a match. No keystroke-based search — one server call per sport per cache window.

## Required Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `APISPORTS_KEY` | Yes | — | Your API-Football key. If missing, the app falls back to mock data. |
| `FIXTURES_PROVIDER` | No | auto-detect | `api_football` or `mock`. Auto-detects from APISPORTS_KEY if not set. |
| `APISPORTS_TZ` | No | `Europe/Paris` | Timezone for API-Football fixture times |
| `SPORTS_DEBUG` | No | `0` | Set to `1` to enable debug logging for provider calls |
| `SPORTS_REFRESH_TOKEN` | No | — | Admin token for server-side refresh polling |

## API-Football Setup

1. Get an API key from [api-sports.io](https://www.api-sports.io/) or [RapidAPI API-Football](https://rapidapi.com/api-sports/api/api-football)
2. Set `APISPORTS_KEY` in your `.env.local`
3. Optionally set `FIXTURES_PROVIDER=api_football` (auto-detected if APISPORTS_KEY is set)

### Authentication

```
Header: x-apisports-key: YOUR_KEY
Host: v3.football.api-sports.io
```

### Endpoint Used

```
GET /fixtures?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Europe/Paris
```

### Response Shape

```json
{
  "response": [
    {
      "fixture": {
        "id": 12345,
        "date": "2026-02-15T20:00:00+01:00",
        "status": { "short": "NS", "long": "Not Started" },
        "venue": { "name": "Parc des Princes" }
      },
      "league": {
        "id": 61,
        "name": "Ligue 1",
        "country": "France",
        "round": "Regular Season - 25"
      },
      "teams": {
        "home": { "id": 85, "name": "Paris Saint Germain" },
        "away": { "id": 81, "name": "Marseille" }
      }
    }
  ]
}
```

### Status Mapping

| API-Football `status.short` | Our status |
|---|---|
| `NS`, `TBD` | `scheduled` |
| `1H`, `HT`, `2H`, `ET`, `BT`, `P`, `LIVE`, `INT` | `live` |
| `FT`, `AET`, `PEN`, `AWD`, `WO` | `finished` |
| `CANC`, `PST`, `ABD`, `SUSP` | `scheduled` (for listing) |

## How It Works

1. User selects a sport category and enters match mode
2. User clicks "Pick a match" → opens a modal
3. In the modal: select sport, click Load → ONE POST to `/api/sports/search`
4. `fixturesProvider` selects backend (mock or api_football) based on env config
5. If api_football: calls API-Football for 7 days of fixtures (1 API call), caches 15 min, applies T-2 to end_time
6. If mock: returns 19 built-in fixtures with T-2 already applied
7. Modal shows scrollable list with day headers + client-side text filter (no extra API calls)
8. User clicks a match → auto-fills: home team, away team, start time, end time (T-2), provider event ID, provider name
9. Modal closes, user writes any question and creates the market
10. If no match selected, user can still create manually (provider = "manual")

## Trade Page: Sport Status & Lock Logic

The trade page (`app/trade/[id]/page.tsx`) computes sport phase from `sportMeta.start_time` and `end_date`:

| Phase | Condition | UI |
|---|---|---|
| `scheduled` | `now < sportStartTime` | Blue "Scheduled" badge |
| `live` | `sportStartTime <= now < end_date` | Red pulsing "Live" badge |
| `locked` | `now >= end_date` (T-2) | Yellow "Trading closed (T-2)" badge, trading disabled |
| `finished` | Sport event finished or `sportTradingState === "ended_by_sport"` | Gray banner, trading disabled |

A client-side timer (15s interval) updates `now` so the UI auto-transitions between phases without page reload.

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
      "provider": "api-football",
      "provider_event_id": "12345",
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

- **Provider-level (fixturesProvider):** 15 min in-memory TTL cache keyed by `provider + sport + base_date + days`.
- **Route-level (search route):** 10 min in-memory TTL cache keyed by `sport + base_date + q`.
- **Client-side filter:** Purely local, zero API calls. Filters the already-loaded list by substring.

## Fallback Behavior

If `APISPORTS_KEY` is not set (or `FIXTURES_PROVIDER=mock`):
- `/api/sports/search` returns mock matches spread across 7 days (19 fixtures across all sports)
- `/api/sports/refresh-one` falls back to the legacy mock provider
- `/api/sports/create-event` inserts basic data without enrichment

The app works fully in development without an API key.

## Provider Field Values

| Value | Meaning |
|---|---|
| `api-football` | Match linked to API-Football provider event |
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
| `RAPIDAPI_KEY` | — |
| `RAPIDAPI_HOST_FOOTBALL` | `api-football-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_BASKETBALL` | `api-basketball.p.rapidapi.com` |
| `RAPIDAPI_HOST_TENNIS` | `api-tennis-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_MMA` | `api-mma-v1.p.rapidapi.com` |
| `RAPIDAPI_HOST_AMERICAN_FOOTBALL` | `api-american-football-v1.p.rapidapi.com` |
