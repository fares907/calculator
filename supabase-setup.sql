-- ============================================================================
--  إعداد قاعدة البيانات للمزامنة بين الأجهزة
--  الصق الكود ده كله في:  Supabase → SQL Editor → New query → Run
-- ============================================================================

create table if not exists public.moves (
  id          uuid        primary key,
  room        text        not null,
  type        text        not null check (type in ('in','out')),
  mat         text        not null check (mat in ('steel','cement')),
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

-- الفهرس ده هو اللي بيخلي المزامنة سريعة مهما كبر السجل
create index if not exists moves_room_updated_idx
  on public.moves (room, updated_at);

create index if not exists moves_room_ts_idx
  on public.moves (room, ts desc);

-- تفعيل حماية الصفوف
alter table public.moves enable row level security;

-- سياسة الوصول: أي حد معاه المفتاح العام + رقم الغرفة يقدر يقرا ويكتب.
-- الحماية الحقيقية هنا = إن "رمز الربط" (اللي فيه المفتاح ورقم الغرفة) سري.
-- متبعتوش لحد بره الشركة.
drop policy if exists "app access" on public.moves;
create policy "app access" on public.moves
  for all
  to anon, authenticated
  using (true)
  with check (true);
