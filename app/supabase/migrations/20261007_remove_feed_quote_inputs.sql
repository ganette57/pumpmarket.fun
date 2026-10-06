-- Apply only after all old feed callers have been retired.
begin;

drop function if exists public.play_feed_quote_inputs(text[]);

commit;
