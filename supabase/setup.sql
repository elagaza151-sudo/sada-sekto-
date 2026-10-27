-- ساده سكتو: إعداد قاعدة البيانات على Supabase
-- الصق الملف كله في SQL Editor واضغط Run (مرة واحدة). آمن لو اتشغّل تاني.

create extension if not exists pgcrypto with schema extensions;

/* ---------- الجداول ---------- */
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null check (role in ('manager','barista')),
  last_login timestamptz,
  created_at timestamptz not null default now());

create table if not exists public.menu_items(
  id bigint generated always as identity primary key,
  category text not null, name text unique not null, descr text not null default '',
  price int not null check (price between 0 and 100000),
  active boolean not null default true, pos int not null default 0,
  discount int not null default 0 check (discount between 0 and 90));

create table if not exists public.orders(
  id bigint generated always as identity primary key,
  public_id uuid unique not null default gen_random_uuid(),
  name text not null, place text not null, items jsonb not null, total int not null,
  status text not null default 'new' check (status in ('new','prep','ready','done')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  done_by text, done_at timestamptz, promo text, discount int not null default 0);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_done_at on public.orders(done_at);

-- بيانات الطلب والدفع (آمن عند إعادة تشغيل الملف)
alter table public.orders add column if not exists notes text not null default '';
alter table public.orders add column if not exists payment_method text not null default 'cash' check (payment_method in ('cash','card','instapay'));

create table if not exists public.payment_settings(
  id int primary key default 1 check (id = 1),
  bank_name text not null default '',
  bank_account text not null default '',
  instapay_number text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.payment_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.bookings(
  id bigint generated always as identity primary key,
  public_id uuid unique not null default gen_random_uuid(),
  name text not null, phone text not null, date date not null, time text not null, guests int not null,
  status text not null default 'pending' check (status in ('pending','ok','no')),
  created_at timestamptz not null default now());

create table if not exists public.promos(
  id bigint generated always as identity primary key,
  code text unique not null, kind text not null check (kind in ('percent','fixed')), value int not null,
  min_total int not null default 0, max_uses int not null default 0, used int not null default 0,
  expires date, active boolean not null default true, created_at timestamptz not null default now());

create table if not exists public.promo_fail(ts timestamptz not null default now()); -- لمنع تخمين أكواد الخصم

/* ---------- الصلاحيات (RLS) ---------- */
alter table public.profiles enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.bookings enable row level security;
alter table public.promos enable row level security;
alter table public.promo_fail enable row level security;
alter table public.payment_settings enable row level security;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to anon, authenticated;

revoke all on public.profiles, public.menu_items, public.orders, public.bookings, public.promos, public.promo_fail from anon, authenticated;
grant select on public.menu_items to anon, authenticated;
grant insert, update, delete on public.menu_items to authenticated;
grant select on public.profiles, public.orders, public.bookings to authenticated;
grant update (status) on public.bookings to authenticated;
grant select, insert, update, delete on public.promos to authenticated;
grant select, update on public.payment_settings to authenticated;

drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select to authenticated using (id = auth.uid() or public.my_role() = 'manager');

drop policy if exists p_menu_sel on public.menu_items;
create policy p_menu_sel on public.menu_items for select to anon, authenticated using (active or public.my_role() is not null);
drop policy if exists p_menu_ins on public.menu_items;
create policy p_menu_ins on public.menu_items for insert to authenticated with check (public.my_role() = 'manager');
drop policy if exists p_menu_upd on public.menu_items;
create policy p_menu_upd on public.menu_items for update to authenticated using (public.my_role() = 'manager') with check (public.my_role() = 'manager');
drop policy if exists p_menu_del on public.menu_items;
create policy p_menu_del on public.menu_items for delete to authenticated using (public.my_role() = 'manager');

drop policy if exists p_orders_sel on public.orders;
create policy p_orders_sel on public.orders for select to authenticated using (public.my_role() is not null);

drop policy if exists p_book_sel on public.bookings;
create policy p_book_sel on public.bookings for select to authenticated using (public.my_role() is not null);
drop policy if exists p_book_upd on public.bookings;
create policy p_book_upd on public.bookings for update to authenticated using (public.my_role() is not null) with check (public.my_role() is not null);

drop policy if exists p_payment_settings_manager on public.payment_settings;
create policy p_payment_settings_manager on public.payment_settings for all to authenticated using (public.my_role() = 'manager') with check (public.my_role() = 'manager');

drop policy if exists p_promos_all on public.promos;
create policy p_promos_all on public.promos for all to authenticated using (public.my_role() = 'manager') with check (public.my_role() = 'manager');

/* ---------- أدوات داخلية ---------- */
create or replace function public._clean(s text, n int) returns text
language sql immutable as $$ select left(btrim(regexp_replace(coalesce(s,''), '[\u0001-\u001f<>]', '', 'g')), n) $$;

create or replace function public._cairo_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- بيحسب الطلب كله في السيرفر: السعر اللي الزبون يبعته مش بنصدّقه
create or replace function public._price_order(p_items jsonb, p_code text, p_lock boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; n text; q int; mi record; pr record; lines jsonb := '[]'; subtotal int := 0; disc int := 0; v_code text; unit int;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then return jsonb_build_object('error','الطلب فاضي.'); end if;
  if jsonb_array_length(p_items) > 40 then return jsonb_build_object('error','في صنف مش صحيح في الطلب.'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    n := it->>'n';
    begin q := floor((it->>'q')::numeric)::int; exception when others then q := 0; end;
    select * into mi from menu_items where name = n and active;
    if not found or q < 1 or q > 20 then return jsonb_build_object('error','في صنف مش صحيح في الطلب.'); end if;
    unit := round(mi.price * (100 - mi.discount) / 100.0)::int;
    lines := lines || jsonb_build_object('n', n, 'q', q, 'p', unit);
    subtotal := subtotal + unit * q;
  end loop;
  v_code := upper(public._clean(p_code, 30));
  if v_code = '' then return jsonb_build_object('lines', lines, 'subtotal', subtotal, 'discount', 0, 'total', subtotal); end if;
  if (select count(*) from promo_fail where ts > now() - interval '1 minute') >= 30 then return jsonb_build_object('error','طلبات كتير، استنى شوية وجرّب تاني.'); end if;
  if p_lock then select * into pr from promos where promos.code = v_code for update;
  else select * into pr from promos where promos.code = v_code; end if;
  if not found or not pr.active then
    insert into promo_fail default values; delete from promo_fail where ts < now() - interval '1 hour';
    return jsonb_build_object('error','كود الخصم مش صحيح.');
  end if;
  if pr.expires is not null and public._cairo_today() > pr.expires then return jsonb_build_object('error','كود الخصم انتهى.'); end if;
  if pr.max_uses > 0 and pr.used >= pr.max_uses then return jsonb_build_object('error','كود الخصم خلص عدد مرات استخدامه.'); end if;
  if subtotal < pr.min_total then return jsonb_build_object('error','الكود ده للطلبات من ' || pr.min_total || ' ج.م فأكتر.'); end if;
  disc := least(subtotal, case when pr.kind = 'percent' then floor(subtotal * pr.value / 100.0)::int else pr.value end);
  return jsonb_build_object('lines', lines, 'subtotal', subtotal, 'discount', disc, 'total', subtotal - disc, 'promo_id', pr.id, 'promo_code', pr.code);
end $$;
revoke all on function public._price_order(jsonb, text, boolean) from public, anon, authenticated;

/* ---------- دوال الزبون (من غير تسجيل دخول) ---------- */
create or replace function public.check_promo(p_items jsonb, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb := public._price_order(p_items, p_code, false);
begin
  if o ? 'error' then return o; end if;
  return jsonb_build_object('subtotal', o->'subtotal', 'discount', o->'discount', 'total', o->'total');
end $$;

create or replace function public.place_order(p_items jsonb, p_place text, p_name text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb; r record; places text[] := array['تيك أواي','طاولة 1','طاولة 2','طاولة 3','طاولة 4','طاولة 5','طاولة 6','التراس 1','التراس 2','التراس 3'];
begin
  if not (p_place = any(places)) then return jsonb_build_object('error','اختار مكان الاستلام.'); end if;
  -- حماية من السبام: حد أقصى للطلبات الجديدة المفتوحة وفي الدقيقة
  if (select count(*) from orders where created_at > now() - interval '1 minute') >= 40
     or (select count(*) from orders where status = 'new') >= 150 then
    return jsonb_build_object('error','طلبات كتير، استنى شوية وجرّب تاني.');
  end if;
  o := public._price_order(p_items, p_code, true);
  if o ? 'error' then return o; end if;
  if o ? 'promo_id' then
    update promos set used = used + 1 where id = (o->>'promo_id')::bigint and (max_uses = 0 or used < max_uses);
    if not found then return jsonb_build_object('error','كود الخصم خلص عدد مرات استخدامه.'); end if;
  end if;
  insert into orders(name, place, items, total, promo, discount)
  values (coalesce(nullif(public._clean(p_name, 40), ''), 'بدون اسم'), p_place, o->'lines', (o->>'total')::int, o->>'promo_code', (o->>'discount')::int)
  returning id, public_id, total, discount into r;
  return jsonb_build_object('id', r.id, 'ref', r.public_id, 'total', r.total, 'discount', r.discount);
end $$;

create or replace function public.place_order_v2(p_items jsonb, p_place text, p_name text, p_code text, p_notes text, p_payment_method text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb; r record; places text[] := array['تيك أواي','طاولة 1','طاولة 2','طاولة 3','طاولة 4','طاولة 5','طاولة 6','التراس 1','التراس 2','التراس 3']; pm text := coalesce(p_payment_method,'cash');
begin
  if not (p_place = any(places)) then return jsonb_build_object('error','اختار مكان الاستلام.'); end if;
  if pm not in ('cash','card','instapay') then return jsonb_build_object('error','اختار طريقة دفع صحيحة.'); end if;
  if p_place <> 'تيك أواي' then pm := 'cash'; end if;
  if (select count(*) from orders where created_at > now() - interval '1 minute') >= 40 or (select count(*) from orders where status = 'new') >= 150 then return jsonb_build_object('error','طلبات كتير، استنى شوية وجرّب تاني.'); end if;
  o := public._price_order(p_items, p_code, true); if o ? 'error' then return o; end if;
  if o ? 'promo_id' then update promos set used = used + 1 where id = (o->>'promo_id')::bigint and (max_uses = 0 or used < max_uses); if not found then return jsonb_build_object('error','كود الخصم خلص عدد مرات استخدامه.'); end if; end if;
  insert into orders(name, place, items, total, promo, discount, notes, payment_method)
  values (coalesce(nullif(public._clean(p_name,40),''),'بدون اسم'),p_place,o->'lines',(o->>'total')::int,o->>'promo_code',(o->>'discount')::int,public._clean(p_notes,250),pm)
  returning id, public_id, total, discount into r;
  return jsonb_build_object('id',r.id,'ref',r.public_id,'total',r.total,'discount',r.discount);
end $$;
revoke all on function public.place_order_v2(jsonb,text,text,text,text,text) from public;
grant execute on function public.place_order_v2(jsonb,text,text,text,text,text) to anon, authenticated;

create or replace function public.track_order(p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; r record;
begin
  begin u := p_ref::uuid; exception when others then return jsonb_build_object('error','الطلب مش موجود.'); end;
  select id, status into r from orders where public_id = u;
  if not found then return jsonb_build_object('error','الطلب مش موجود.'); end if;
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.place_booking(p_name text, p_phone text, p_date text, p_time text, p_guests int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nm text := public._clean(p_name, 40); ph text := public._clean(p_phone, 11); d date; ref uuid;
begin
  if nm = '' or ph !~ '^01[0-9]{9}$' or p_date !~ '^\d{4}-\d{2}-\d{2}$' or p_time !~ '^([01]\d|2[0-3]):[0-5]\d$' or not (p_guests between 1 and 12) then
    return jsonb_build_object('error','راجع بيانات الحجز.');
  end if;
  begin d := p_date::date; exception when others then return jsonb_build_object('error','راجع بيانات الحجز.'); end;
  if d < public._cairo_today() then return jsonb_build_object('error','التاريخ فات.'); end if;
  if p_time < '08:00' or p_time > '23:30' then return jsonb_build_object('error','إحنا فاتحين من 8 الصبح لحد 12 بالليل.'); end if;
  if (select count(*) from bookings where created_at > now() - interval '1 minute') >= 20
     or (select count(*) from bookings where status = 'pending') >= 200 then
    return jsonb_build_object('error','طلبات كتير، استنى شوية وجرّب تاني.');
  end if;
  insert into bookings(name, phone, date, time, guests) values (nm, ph, d, p_time, p_guests) returning public_id into ref;
  return jsonb_build_object('ok', true, 'ref', ref);
end $$;

create or replace function public.track_booking(p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; r record;
begin
  begin u := p_ref::uuid; exception when others then return jsonb_build_object('error','الحجز مش موجود.'); end;
  select status, date, time into r from bookings where public_id = u;
  if not found then return jsonb_build_object('error','الحجز مش موجود.'); end if;
  return jsonb_build_object('status', r.status, 'date', r.date, 'time', r.time);
end $$;

/* ---------- دوال الباريستا والمدير ---------- */
create or replace function public.touch_login() returns void
language sql security definer set search_path = public as $$ update profiles set last_login = now() where id = auth.uid() $$;

create or replace function public.set_order_status(p_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text;
begin
  select username into me from profiles where id = auth.uid();
  if me is null then return jsonb_build_object('error','لازم تسجّل دخول.'); end if;
  if p_status not in ('new','prep','ready','done') then return jsonb_build_object('error','حالة غلط.'); end if;
  update orders set status = p_status, updated_at = now(),
    done_by = case when p_status = 'done' then me end, done_at = case when p_status = 'done' then now() end
  where id = p_id;
  if not found then return jsonb_build_object('error','الطلب مش موجود.'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cancel_order(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then return jsonb_build_object('error','لازم تسجّل دخول.'); end if;
  delete from orders where id = p_id and status = 'new';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_users() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
begin
  if public.my_role() is distinct from 'manager' then return jsonb_build_object('error','الصلاحية دي للمدير بس.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'role', u.role,
      'last_login', extract(epoch from u.last_login) * 1000,
      'today_orders', (select count(*) from orders o where o.done_by = u.username and o.done_at >= t0),
      'today_total', (select coalesce(sum(total), 0) from orders o where o.done_by = u.username and o.done_at >= t0)) order by u.created_at) from profiles u), '[]'::jsonb);
end $$;

-- إنشاء حساب: الإيميل الداخلي username@sada.example.com (الموظف مش بيشوفه)
create or replace function public._make_user(p_username text, p_role text, p_pw text) returns jsonb
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text; un text := lower(public._clean(p_username, 30));
begin
  if un !~ '^[a-z0-9_.-]{3,30}$' then return jsonb_build_object('error','اسم المستخدم: 3 لـ 30 حرف إنجليزي أو أرقام.'); end if;
  if length(coalesce(p_pw,'')) < 8 then return jsonb_build_object('error','كلمة السر لازم تكون 8 حروف على الأقل.'); end if;
  if p_role not in ('manager','barista') then p_role := 'barista'; end if;
  if exists (select 1 from profiles where username = un) then return jsonb_build_object('error','اسم المستخدم موجود.'); end if;
  em := un || '@sada.example.com';
  if exists (select 1 from auth.users where email = em) then return jsonb_build_object('error','اسم المستخدم موجود.'); end if;
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em, extensions.crypt(p_pw, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities(id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', em), 'email', uid::text, now(), now(), now());
  insert into profiles(id, username, role) values (uid, un, p_role);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public._make_user(text, text, text) from public, anon, authenticated;

create or replace function public.admin_create_user(p_username text, p_pw text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'manager' then return jsonb_build_object('error','الصلاحية دي للمدير بس.'); end if;
  return public._make_user(p_username, p_role, p_pw);
end $$;

create or replace function public.admin_set_password(p_id uuid, p_pw text) returns jsonb
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if public.my_role() is distinct from 'manager' then return jsonb_build_object('error','الصلاحية دي للمدير بس.'); end if;
  if length(coalesce(p_pw,'')) < 8 then return jsonb_build_object('error','كلمة السر لازم تكون 8 حروف على الأقل.'); end if;
  if not exists (select 1 from profiles where id = p_id) then return jsonb_build_object('error','الحساب مش موجود.'); end if;
  update auth.users set encrypted_password = extensions.crypt(p_pw, extensions.gen_salt('bf')), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_delete_user(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare target record;
begin
  if public.my_role() is distinct from 'manager' then return jsonb_build_object('error','الصلاحية دي للمدير بس.'); end if;
  if p_id = auth.uid() then return jsonb_build_object('error','مينفعش تحذف حسابك اللي داخل بيه.'); end if;
  select * into target from profiles where id = p_id;
  if not found then return jsonb_build_object('error','الحساب مش موجود.'); end if;
  if target.role = 'manager' and (select count(*) from profiles where role = 'manager') < 2 then return jsonb_build_object('error','لازم يفضل مدير واحد على الأقل.'); end if;
  delete from auth.users where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

/* صلاحيات تنفيذ الدوال */
do $$ declare f text; begin
  foreach f in array array[
    'check_promo(jsonb,text)','place_order(jsonb,text,text,text)','place_order_v2(jsonb,text,text,text,text,text)','track_order(text)','place_booking(text,text,text,text,int)','track_booking(text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'touch_login()','set_order_status(bigint,text)','cancel_order(bigint)','admin_users()','admin_create_user(text,text,text)','admin_set_password(uuid,text)','admin_delete_user(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

/* ---------- التحديث اللحظي ---------- */
do $$ begin
  begin alter publication supabase_realtime add table public.orders; exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.bookings; exception when duplicate_object or undefined_object then null; end;
end $$;

/* ---------- المنيو الابتدائي (بيتحمّل مرة واحدة بس لو الجدول فاضي) ---------- */
insert into public.menu_items(category, name, descr, price, pos)
select * from (values
('قهوة ساخنة','إسبريسو','شوت مركّز من بن الحمصة اليومية',45,0),('قهوة ساخنة','دبل إسبريسو','شوتين للي عايز يفوق',60,1),('قهوة ساخنة','أمريكانو','إسبريسو وماية سخنة',55,2),('قهوة ساخنة','كابتشينو','إسبريسو ولبن مبخّر وفوم كريمي',65,3),('قهوة ساخنة','لاتيه','ناعم وهادي',70,4),('قهوة ساخنة','فلات وايت','إسبريسو ولبن مخمّل',75,5),('قهوة ساخنة','موكا','شوكولاتة وإسبريسو ولبن',80,6),('قهوة ساخنة','قهوة تركي','على الرمل زي زمان',40,7),('قهوة ساخنة','قهوة فرنساوي','بالكريمة السايحة',60,8),
('مشروبات باردة','آيس لاتيه','إسبريسو على تلج ولبن بارد',75,9),('مشروبات باردة','آيس أمريكانو','إسبريسو وتلج',60,10),('مشروبات باردة','كولد برو','منقوع 18 ساعة',80,11),('مشروبات باردة','آيس موكا','شوكولاتة وقهوة على تلج',85,12),('مشروبات باردة','فرابيه كراميل','مخفوق ببصوص الكراميل',90,13),('مشروبات باردة','ليمون بالنعناع','فريش ومنعش',50,14),('مشروبات باردة','آيس تي خوخ','شاي بارد بنكهة الخوخ',55,15),
('شاي وأعشاب','شاي ساده','كباية شاي مظبوطة',30,16),('شاي وأعشاب','شاي بلبن','على الطريقة المصرية',35,17),('شاي وأعشاب','شاي أخضر','بالنعناع أو الياسمين',40,18),('شاي وأعشاب','ينسون','دافي وهادي',35,19),('شاي وأعشاب','قرفة بالحليب','للشتا',45,20),('شاي وأعشاب','كركديه','سخن أو بارد',40,21),
('عصاير وميلك شيك','عصير برتقال','فريش',55,22),('عصاير وميلك شيك','عصير مانجو','في موسمه',65,23),('عصاير وميلك شيك','عصير فراولة','فريش بالتلج',65,24),('عصاير وميلك شيك','ميلك شيك فانيليا','كريمي وتقيل',80,25),('عصاير وميلك شيك','ميلك شيك شوكولاتة','بصوص الشوكولاتة',85,26),('عصاير وميلك شيك','ميلك شيك أوريو','بقطع البسكوت',90,27),
('حلويات','كرواسون زبدة','طازج كل يوم',55,28),('حلويات','كرواسون شوكولاتة','محشي شوكولاتة داكنة',65,29),('حلويات','تشيز كيك','بصوص توت',90,30),('حلويات','براوني','شوكولاتة داكنة وجوز',70,31),('حلويات','كوكيز','ساخن بقطع الشوكولاتة',40,32),('حلويات','أم علي','في الفرن',75,33),('حلويات','كيك الجزر','بكريمة الجبنة',80,34),
('سناكس وساندوتشات','ساندوتش جبنة رومي','على توست محمّص',70,35),('سناكس وساندوتشات','ساندوتش ديك رومي','جبنة وخس وطماطم',95,36),('سناكس وساندوتشات','ساندوتش فراخ كريسبي','بصوص خاص',110,37),('سناكس وساندوتشات','بانيني موتزاريلا','جبنة وطماطم وريحان',100,38),('سناكس وساندوتشات','بطاطس مقلية','مع صوص الجبنة',50,39),('سناكس وساندوتشات','سلطة سيزر','فراخ مشوية',105,40)
) as v(category, name, descr, price, pos)
where not exists (select 1 from public.menu_items);
