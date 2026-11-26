-- NATHBOOK — author metadata + verified customer reviews
-- Run once in Supabase Dashboard > SQL Editor.
-- Reviews are visible publicly only after status='approved'.
-- A review can be submitted only by the authenticated owner of a paid order containing the ebook.

alter table public.ebooks
  add column if not exists author text not null default 'Nath';

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  ebook_id uuid not null references public.ebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(trim(body)) between 8 and 1200),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  constraint reviews_one_per_user_per_ebook unique (user_id, ebook_id)
);

create index if not exists reviews_public_ebook_idx
  on public.reviews (ebook_id, status, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists "Anyone can read approved ebook reviews" on public.reviews;
create policy "Anyone can read approved ebook reviews"
  on public.reviews for select
  using (status = 'approved' or auth.uid() = user_id);

drop policy if exists "Verified buyers can submit pending reviews" on public.reviews;
create policy "Verified buyers can submit pending reviews"
  on public.reviews for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and exists (
      select 1
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where o.user_id = auth.uid()
        and o.status = 'paid'
        and oi.ebook_id = reviews.ebook_id
    )
  );

-- No update policy is intentionally granted: customers cannot approve/edit their own reviews.
-- Moderate reviews in Supabase Table Editor by setting status to 'approved' or 'rejected'
-- using an administrator/service-role session.
