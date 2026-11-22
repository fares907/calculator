-- ============================================================================
--  إعداد قاعدة البيانات للمزامنة بين الأجهزة — الإصدار 2 (مؤمّن)
--  الصق الكود ده كله في:  Supabase → SQL Editor → New query → Run
--  آمن إنك تشغّله أكتر من مرة، وآمن على قاعدة بيانات قديمة (مش بيمسح حاجة).
--
--  ليه الإصدار ده؟
--    النسخة القديمة كان فيها سياسة "using (true)" — يعني أي حد معاه المفتاح
--    العام يقدر يقرا ويعدّل ويمسح بيانات كل الغرف. هنا الجدول بيتقفل تماماً،
--    والوصول بيبقى عن طريق دالتين بس، كل دالة محصورة في غرفة واحدة.
-- ============================================================================

create table if not exists public.moves (
  id          uuid        primary key,
  room        text        not null,
  type        text        not null check (type in ('in','out')),
  mat         text        not null check (mat in ('steel','cement')),
  item        text        not null default '',
  qty_ton     numeric     not null default 0,
  unit_price  numeric     not null default 0,
  value       numeric     not null default 0,
  note        text        not null default '',
  party       text        not null default '',
  ref         text        not null default '',
  ts          bigint      not null,
  updated_at  bigint      not null,
  del         smallint    not null default 0
);

-- عمود الصنف (جديد في الإصدار 2) — لو الجدول قديم
alter table public.moves add column if not exists item text not null default '';

create index if not exists moves_room_updated_idx on public.moves (room, updated_at);
create index if not exists moves_room_ts_idx      on public.moves (room, ts desc);

-- ── 1. قفل الجدول تماماً ──────────────────────────────────────────────────
alter table public.moves enable row level security;
alter table public.moves force row level security;
drop policy if exists "app access" on public.moves;      -- السياسة القديمة المفتوحة
revoke all on public.moves from anon, authenticated;

-- ── 2. دالة التنزيل: بترجّع حركات غرفة واحدة بس ─────────────────────────
create or replace function public.binaa_pull(p_room text, p_since bigint, p_limit int default 500)
returns setof public.moves
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.moves
  where length(p_room) >= 20
    and room = p_room
    and updated_at > coalesce(p_since, 0)
  order by updated_at asc
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

-- ── 3. دالة الرفع: بتكتب في غرفة واحدة، ومستحيل تكتب فوق غرفة تانية ─────
create or replace function public.binaa_push(p_room text, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_room is null or length(p_room) < 20 or length(p_room) > 64 then
    raise exception 'invalid room';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'invalid payload';
  end if;

  insert into public.moves as m
    (id, room, type, mat, item, qty_ton, unit_price, value, note, party, ref, ts, updated_at, del)
  select
    (r->>'id')::uuid,
    p_room,
    r->>'type',
    r->>'mat',
    left(coalesce(r->>'item', ''), 40),
    abs(coalesce((r->>'qty_ton')::numeric, 0)),
    abs(coalesce((r->>'unit_price')::numeric, 0)),
    coalesce((r->>'value')::numeric, 0),
    left(coalesce(r->>'note', ''), 300),
    left(coalesce(r->>'party', ''), 120),
    left(coalesce(r->>'ref', ''), 60),
    coalesce((r->>'ts')::bigint, 0),
    coalesce((r->>'updated_at')::bigint, 0),
    case when coalesce((r->>'del')::int, 0) = 1 then 1 else 0 end
  from jsonb_array_elements(p_rows) as r
  on conflict (id) do update set
    type = excluded.type, mat = excluded.mat, item = excluded.item,
    qty_ton = excluded.qty_ton, unit_price = excluded.unit_price, value = excluded.value,
    note = excluded.note, party = excluded.party, ref = excluded.ref,
    ts = excluded.ts, updated_at = excluded.updated_at, del = excluded.del
  where m.room = excluded.room                 -- ممنوع تلمس حركة غرفة تانية
    and m.updated_at <= excluded.updated_at;   -- الأحدث بيكسب

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.binaa_pull(text, bigint, int) from public;
revoke all on function public.binaa_push(text, jsonb)       from public;
grant execute on function public.binaa_pull(text, bigint, int) to anon, authenticated;
grant execute on function public.binaa_push(text, jsonb)       to anon, authenticated;
