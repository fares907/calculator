-- ============================================================================
--  قاعدة بيانات المزامنة — الإصدار 3
--  الصق الكود ده كله في:  Supabase → SQL Editor → New query → Run
--  آمن إنك تشغّله أكتر من مرة، وآمن على قاعدة قديمة (مش بيمسح حاجة).
--
--  الأمان:
--   • الجداول مقفولة تماماً على المفتاح العام (مفيش سياسة واحدة مفتوحة).
--   • الوصول عن طريق دوال بس، وكل دالة محصورة في "غرفة" واحدة.
--   • رقم الغرفة السري مش متخزن في القاعدة — متخزن "بصمته" (SHA-256)،
--     فحتى لو القاعدة نفسها اتسرّبت، محدش يقدر يطلع منها رمز الربط.
--   • حدود على حجم الدفعات وأطوال النصوص.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ── الحركات ──────────────────────────────────────────────────────────────
create table if not exists public.moves (
  id          uuid        primary key,
  room        text        not null,             -- بصمة الغرفة (sha256 hex)
  type        text        not null check (type in ('in','out')),
  mat         text        not null check (mat in ('steel','cement')),
  item        text        not null default '',
  qty_ton     numeric     not null default 0,
  unit_price  numeric     not null default 0,
  value       numeric     not null default 0,
  note        text        not null default '',
  party       text        not null default '',
  ref         text        not null default '',
  by_name     text        not null default '',
  ts          bigint      not null,
  updated_at  bigint      not null,
  del         smallint    not null default 0
);
alter table public.moves add column if not exists item    text not null default '';
alter table public.moves add column if not exists by_name text not null default '';

-- ترقية من الإصدارات القديمة: رقم الغرفة كان متخزن صريح → نحوّله لبصمة
update public.moves
   set room = encode(extensions.digest(room, 'sha256'), 'hex')
 where length(room) < 64;

create index if not exists moves_room_updated_idx on public.moves (room, updated_at);

-- ── الدفعات (حسابات العملاء والموردين) ───────────────────────────────────
create table if not exists public.payments (
  id          uuid        primary key,
  room        text        not null,
  party       text        not null,
  dir         text        not null check (dir in ('in','out')),   -- in = استلمنا فلوس، out = دفعنا
  amount      numeric     not null default 0,
  method      text        not null default '',
  note        text        not null default '',
  ref         text        not null default '',
  by_name     text        not null default '',
  ts          bigint      not null,
  updated_at  bigint      not null,
  del         smallint    not null default 0
);
create index if not exists payments_room_updated_idx on public.payments (room, updated_at);

-- ── إعدادات مشتركة (الأصناف والأسعار) ────────────────────────────────────
create table if not exists public.room_meta (
  room        text        not null,
  k           text        not null check (k in ('items','prices')),
  v           jsonb       not null,
  updated_at  bigint      not null,
  primary key (room, k)
);

-- ── قفل الجداول ──────────────────────────────────────────────────────────
alter table public.moves     enable row level security;
alter table public.payments  enable row level security;
alter table public.room_meta enable row level security;
alter table public.moves     force row level security;
alter table public.payments  force row level security;
alter table public.room_meta force row level security;
drop policy if exists "app access" on public.moves;      -- السياسة القديمة المفتوحة
revoke all on public.moves, public.payments, public.room_meta from anon, authenticated;

-- الدوال القديمة (الإصدار 2) بتتشال
drop function if exists public.binaa_pull(text, bigint, int);
drop function if exists public.binaa_push(text, jsonb);

-- ── بصمة الغرفة ──────────────────────────────────────────────────────────
create or replace function public.binaa_room(p_room text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_room is null or p_room !~ '^[A-Za-z0-9]{20,64}$' then
    raise exception 'invalid room';
  end if;
  return encode(extensions.digest(p_room, 'sha256'), 'hex');
end;
$$;

-- ── الحركات: تنزيل ورفع ──────────────────────────────────────────────────
create or replace function public.binaa_pull(p_room text, p_since bigint, p_limit int default 500)
returns table (id uuid, type text, mat text, item text, qty_ton numeric, unit_price numeric, value numeric,
               note text, party text, ref text, by_name text, ts bigint, updated_at bigint, del smallint)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.type, m.mat, m.item, m.qty_ton, m.unit_price, m.value, m.note, m.party, m.ref, m.by_name, m.ts, m.updated_at, m.del
  from public.moves m
  where m.room = public.binaa_room(p_room) and m.updated_at > coalesce(p_since, 0)
  order by m.updated_at asc
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

create or replace function public.binaa_push(p_room text, p_rows jsonb)
returns int
language plpgsql security definer set search_path = ''
as $$
declare r text := public.binaa_room(p_room); n int;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'invalid payload'; end if;
  insert into public.moves as m (id, room, type, mat, item, qty_ton, unit_price, value, note, party, ref, by_name, ts, updated_at, del)
  select (x->>'id')::uuid, r, x->>'type', x->>'mat', left(coalesce(x->>'item',''),40),
         least(abs(coalesce((x->>'qty_ton')::numeric,0)), 10000000), abs(coalesce((x->>'unit_price')::numeric,0)),
         abs(coalesce((x->>'value')::numeric,0)),
         left(coalesce(x->>'note',''),300), left(coalesce(x->>'party',''),120), left(coalesce(x->>'ref',''),60),
         left(coalesce(x->>'by_name',''),40),
         coalesce((x->>'ts')::bigint,0), coalesce((x->>'updated_at')::bigint,0),
         case when coalesce((x->>'del')::int,0) = 1 then 1 else 0 end
  from jsonb_array_elements(p_rows) x
  on conflict (id) do update set
    type = excluded.type, mat = excluded.mat, item = excluded.item, qty_ton = excluded.qty_ton,
    unit_price = excluded.unit_price, value = excluded.value, note = excluded.note, party = excluded.party,
    ref = excluded.ref, by_name = excluded.by_name, ts = excluded.ts, updated_at = excluded.updated_at, del = excluded.del
  where m.room = excluded.room and m.updated_at <= excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── الدفعات: تنزيل ورفع ──────────────────────────────────────────────────
create or replace function public.binaa_pull_pay(p_room text, p_since bigint, p_limit int default 500)
returns table (id uuid, party text, dir text, amount numeric, method text, note text, ref text, by_name text,
               ts bigint, updated_at bigint, del smallint)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.party, p.dir, p.amount, p.method, p.note, p.ref, p.by_name, p.ts, p.updated_at, p.del
  from public.payments p
  where p.room = public.binaa_room(p_room) and p.updated_at > coalesce(p_since, 0)
  order by p.updated_at asc
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

create or replace function public.binaa_push_pay(p_room text, p_rows jsonb)
returns int
language plpgsql security definer set search_path = ''
as $$
declare r text := public.binaa_room(p_room); n int;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'invalid payload'; end if;
  insert into public.payments as p (id, room, party, dir, amount, method, note, ref, by_name, ts, updated_at, del)
  select (x->>'id')::uuid, r, left(coalesce(x->>'party',''),120), x->>'dir',
         least(abs(coalesce((x->>'amount')::numeric,0)), 1000000000000),
         left(coalesce(x->>'method',''),20), left(coalesce(x->>'note',''),300), left(coalesce(x->>'ref',''),60),
         left(coalesce(x->>'by_name',''),40),
         coalesce((x->>'ts')::bigint,0), coalesce((x->>'updated_at')::bigint,0),
         case when coalesce((x->>'del')::int,0) = 1 then 1 else 0 end
  from jsonb_array_elements(p_rows) x
  on conflict (id) do update set
    party = excluded.party, dir = excluded.dir, amount = excluded.amount, method = excluded.method,
    note = excluded.note, ref = excluded.ref, by_name = excluded.by_name, ts = excluded.ts,
    updated_at = excluded.updated_at, del = excluded.del
  where p.room = excluded.room and p.updated_at <= excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── الإعدادات المشتركة ───────────────────────────────────────────────────
create or replace function public.binaa_meta_pull(p_room text)
returns table (k text, v jsonb, updated_at bigint)
language sql stable security definer set search_path = ''
as $$
  select m.k, m.v, m.updated_at from public.room_meta m where m.room = public.binaa_room(p_room);
$$;

create or replace function public.binaa_meta_push(p_room text, p_k text, p_v jsonb, p_updated_at bigint)
returns int
language plpgsql security definer set search_path = ''
as $$
declare r text := public.binaa_room(p_room); n int;
begin
  if p_k not in ('items','prices') or pg_column_size(p_v) > 65536 then raise exception 'invalid meta'; end if;
  insert into public.room_meta as m (room, k, v, updated_at) values (r, p_k, p_v, p_updated_at)
  on conflict (room, k) do update set v = excluded.v, updated_at = excluded.updated_at
  where m.updated_at < excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── الصلاحيات: الدوال بس ─────────────────────────────────────────────────
revoke all on function public.binaa_room(text) from public, anon, authenticated;
revoke all on function public.binaa_pull(text, bigint, int)      from public;
revoke all on function public.binaa_push(text, jsonb)            from public;
revoke all on function public.binaa_pull_pay(text, bigint, int)  from public;
revoke all on function public.binaa_push_pay(text, jsonb)        from public;
revoke all on function public.binaa_meta_pull(text)              from public;
revoke all on function public.binaa_meta_push(text, text, jsonb, bigint) from public;
grant execute on function public.binaa_pull(text, bigint, int)      to anon, authenticated;
grant execute on function public.binaa_push(text, jsonb)            to anon, authenticated;
grant execute on function public.binaa_pull_pay(text, bigint, int)  to anon, authenticated;
grant execute on function public.binaa_push_pay(text, jsonb)        to anon, authenticated;
grant execute on function public.binaa_meta_pull(text)              to anon, authenticated;
grant execute on function public.binaa_meta_push(text, text, jsonb, bigint) to anon, authenticated;
