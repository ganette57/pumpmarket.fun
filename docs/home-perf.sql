-- Home page performance indexes (run in Supabase SQL editor)

create index if not exists idx_markets_created_at_desc
  on public.markets (created_at desc);

create index if not exists idx_markets_resolved_created_at_desc
  on public.markets (resolved, created_at desc);

create index if not exists idx_markets_resolution_status_created_at_desc
  on public.markets (resolution_status, created_at desc);

create index if not exists idx_markets_category_created_at_desc
  on public.markets (category, created_at desc);

create unique index if not exists idx_markets_market_address_unique
  on public.markets (market_address);

-- Optional stats refresh
analyze public.markets;
