-- Thirty demo: one table that stores every request and response, plus a view for the live numbers.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- No names, emails, phone numbers or health data are stored; IPs are stored only as a salted hash.

create table if not exists public.plans (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  status            text        not null default 'ok' check (status in ('ok', 'error', 'capped')),
  visitor_id        text        not null,            -- random id generated in the browser
  ip_hash           text        not null,            -- sha256(salt + IP), first 32 hex chars
  model             text,                            -- e.g. gemini-3.5-flash-lite
  input             jsonb       not null,            -- take-home pay, five category amounts, optional note (redacted)
  output            jsonb,                           -- the plan returned to the visitor (or the error)
  input_tokens      integer,
  output_tokens     integer,
  thought_tokens    integer,
  latency_ms        integer,
  identified_saving integer,                         -- Rs per month from the two cuts, validated in code
  overspending      boolean,                         -- flexible spending > Free money
  runout_day        integer,                         -- day of month flexible money runs out (null = lasts the month)
  future_amount     integer,                         -- upcoming cost read from the note, Rs
  refusal           boolean     default false,       -- visitor asked for investment/tax/loan advice
  guardrail_flags   jsonb       default '[]'::jsonb  -- fields replaced by the server-side guardrail
);

create index if not exists plans_visitor_idx on public.plans (visitor_id, created_at desc);
create index if not exists plans_ip_idx      on public.plans (ip_hash, created_at desc);
create index if not exists plans_created_idx on public.plans (created_at desc);

-- Lock the table: Row Level Security on, with NO policies, so the public anon/publishable key can
-- neither read nor write. Only the server (Vercel function with the secret key) can.
alter table public.plans enable row level security;

-- Live numbers shown on the landing page.
create or replace view public.plan_stats with (security_invoker = true) as
select
  count(*) filter (where status = 'ok')                                                        as plans_generated,
  coalesce(round(avg(identified_saving) filter (where status = 'ok' and identified_saving > 0)), 0)::int
                                                                                               as avg_saving_per_month,
  coalesce(round(100.0 * avg(overspending::int) filter (where status = 'ok')), 0)::int         as overspending_pct,
  coalesce(round(avg(runout_day) filter (where status = 'ok' and runout_day is not null)), 0)::int
                                                                                               as avg_runout_day,
  count(distinct visitor_id) filter (where status = 'ok')                                      as visitors,
  max(created_at) filter (where status = 'ok')                                                 as last_plan_at
from public.plans;

-- Handy queries for the assignment:
-- select id, created_at, status, input, output->'summary'->>0 as summary_1, runout_day, input_tokens, output_tokens, identified_saving
--   from public.plans order by id desc limit 20;
-- select round(avg(input_tokens)) as avg_in, round(avg(output_tokens)) as avg_out, round(avg(thought_tokens)) as avg_thought
--   from public.plans where status = 'ok';
