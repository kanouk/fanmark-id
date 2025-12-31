-- Create emoji master table for canonical emoji metadata
create table if not exists public.emoji_master (
  id uuid primary key default gen_random_uuid(),
  emoji text not null unique,
  short_name text not null,
  keywords text[] not null default '{}',
  category text,
  subcategory text,
  codepoints text[] not null,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.emoji_master is 'Canonical emoji master data used for normalization and lookup.';

create index if not exists idx_emoji_master_short_name on public.emoji_master using gin (to_tsvector('simple', short_name));
create index if not exists idx_emoji_master_keywords on public.emoji_master using gin (keywords);

create index if not exists idx_emoji_master_category on public.emoji_master (category, subcategory);

alter table public.emoji_master enable row level security;

-- Only admin users may manage emoji master records
create policy "Admins can manage emoji master"
on public.emoji_master
for all
using (public.is_admin())
with check (public.is_admin());

-- Maintain updated_at
create trigger update_emoji_master_updated_at
  before update on public.emoji_master
  for each row
  execute function public.update_updated_at_column();
