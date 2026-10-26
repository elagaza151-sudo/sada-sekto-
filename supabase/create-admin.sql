-- إنشاء حساب المدير الأول (admin). شغّله مرة واحدة بعد setup.sql.
-- غيّر كلمة السر في السطر اللي تحت (8 حروف على الأقل، إنجليزي وأرقام)، وماتحفظهاش في GitHub.
do $$
declare pw text := '172839456'; r jsonb;
begin
  if pw = '172839456' then raise exception 'غيّر كلمة السر في السطر اللي فوق الأول'; end if;
  r := public._make_user('admin', 'manager', pw);
  if r ? 'error' then raise exception '%', r->>'error'; end if;
end $$;
