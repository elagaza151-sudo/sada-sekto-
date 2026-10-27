-- تحديث ميزات الدفع والملاحظات فقط لمشروع ساده سكتو الحالي.
-- لا يحذف أي جداول أو طلبات أو بيانات من المنيو.
-- شغّل هذا الملف مرة واحدة من Supabase > SQL Editor > New query.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash';

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IN ('cash','card','instapay'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.payment_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_name text NOT NULL DEFAULT '',
  bank_account text NOT NULL DEFAULT '',
  instapay_number text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.payment_settings(id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.payment_settings TO authenticated;
DROP POLICY IF EXISTS p_payment_settings_manager ON public.payment_settings;
CREATE POLICY p_payment_settings_manager
  ON public.payment_settings FOR ALL TO authenticated
  USING (public.my_role() = 'manager')
  WITH CHECK (public.my_role() = 'manager');

CREATE OR REPLACE FUNCTION public.place_order_v2(
  p_items jsonb, p_place text, p_name text, p_code text,
  p_notes text, p_payment_method text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb;
  r record;
  places text[] := ARRAY['تيك أواي','طاولة 1','طاولة 2','طاولة 3','طاولة 4','طاولة 5','طاولة 6','التراس 1','التراس 2','التراس 3'];
  pm text := coalesce(p_payment_method,'cash');
BEGIN
  IF NOT (p_place = ANY(places)) THEN
    RETURN jsonb_build_object('error','اختار مكان الاستلام.');
  END IF;
  IF pm NOT IN ('cash','card','instapay') THEN
    RETURN jsonb_build_object('error','اختار طريقة دفع صحيحة.');
  END IF;
  IF p_place <> 'تيك أواي' THEN pm := 'cash'; END IF;
  IF (SELECT count(*) FROM orders WHERE created_at > now() - interval '1 minute') >= 40
     OR (SELECT count(*) FROM orders WHERE status = 'new') >= 150 THEN
    RETURN jsonb_build_object('error','طلبات كتير، استنى شوية وجرّب تاني.');
  END IF;
  o := public._price_order(p_items, p_code, true);
  IF o ? 'error' THEN RETURN o; END IF;
  IF o ? 'promo_id' THEN
    UPDATE promos SET used = used + 1
    WHERE id = (o->>'promo_id')::bigint AND (max_uses = 0 OR used < max_uses);
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error','كود الخصم خلص عدد مرات استخدامه.');
    END IF;
  END IF;
  INSERT INTO orders(name, place, items, total, promo, discount, notes, payment_method)
  VALUES (
    coalesce(nullif(public._clean(p_name,40),''),'بدون اسم'),
    p_place, o->'lines', (o->>'total')::int, o->>'promo_code',
    (o->>'discount')::int, public._clean(p_notes,250), pm
  )
  RETURNING id, public_id, total, discount INTO r;
  RETURN jsonb_build_object('id',r.id,'ref',r.public_id,'total',r.total,'discount',r.discount);
END $$;

REVOKE ALL ON FUNCTION public.place_order_v2(jsonb,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order_v2(jsonb,text,text,text,text,text) TO anon, authenticated;
