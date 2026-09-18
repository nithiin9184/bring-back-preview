-- Subscriptions, Connect Credits and Entitlements ---------------------------
-- The server becomes the single source of truth for plan status, credit
-- balances and daily counters. Nothing here rebuilds existing tables: the
-- existing public.subscriptions table is extended, and two new tables are
-- added for the credit ledger and payment intents.

-- 1. Subscriptions: one row per purchasable plan, per user -------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_id text NOT NULL DEFAULT 'credits';
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_plan_id_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_plan_id_check
      CHECK (plan_id IN ('credits','verification'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_key'
  ) THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_user_id_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_plan_key'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_user_plan_key UNIQUE (user_id, plan_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('inactive','active','cancelled','expired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx
  ON public.subscriptions (user_id, status);

-- 2. Connect Credits ledger --------------------------------------------------
-- Daily credits reset exactly at midnight India time and never carry over:
-- the day's usage is counted from `day`, it is never stored as a balance.
-- Purchased extra credits are real rows and do carry over.
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('daily_spend','extra_spend','extra_purchase')),
  amount integer NOT NULL CHECK (amount > 0),
  reason text,
  payment_intent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date)
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_day_idx
  ON public.credit_ledger (user_id, day, kind);
CREATE INDEX IF NOT EXISTS credit_ledger_user_kind_idx
  ON public.credit_ledger (user_id, kind);

GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own credit ledger read" ON public.credit_ledger;
CREATE POLICY "own credit ledger read" ON public.credit_ledger
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- No client INSERT/UPDATE/DELETE: spends go through spend_connect_credit(),
-- purchases only through a verified payment.

-- 3. Payment intents (real checkout, provider-agnostic) ----------------------
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan','extra_credits')),
  plan_id text CHECK (plan_id IS NULL OR plan_id IN ('credits','verification')),
  credits integer CHECK (credits IS NULL OR credits > 0),
  amount_inr integer NOT NULL CHECK (amount_inr > 0),
  provider text NOT NULL DEFAULT 'razorpay',
  provider_order_id text,
  provider_payment_id text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','paid','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_intents_shape_check CHECK (
    (kind = 'plan' AND plan_id IS NOT NULL AND credits IS NULL)
    OR (kind = 'extra_credits' AND credits IS NOT NULL AND plan_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS payment_intents_user_idx
  ON public.payment_intents (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_provider_order_idx
  ON public.payment_intents (provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

GRANT SELECT ON public.payment_intents TO authenticated;
GRANT ALL ON public.payment_intents TO service_role;
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own payment intents read" ON public.payment_intents;
CREATE POLICY "own payment intents read" ON public.payment_intents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- Intents are created and settled server-side only.

-- 4. Entitlement functions ---------------------------------------------------
-- Either active plan grants the shared Premium entitlement.
CREATE OR REPLACE FUNCTION public.is_premium(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.status = 'active'
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  );
$$;

-- Connect Credits snapshot: daily allowance, today's usage and carried extras.
CREATE OR REPLACE FUNCTION public.credit_snapshot(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  premium boolean := public.is_premium(_user_id);
  allowance integer := CASE WHEN premium THEN 70 ELSE 15 END;
  today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  used integer := 0;
  extra integer := 0;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO used
  FROM public.credit_ledger
  WHERE user_id = _user_id AND kind = 'daily_spend' AND day = today_ist;

  SELECT coalesce(sum(CASE WHEN kind = 'extra_purchase' THEN amount ELSE -amount END), 0)
    INTO extra
  FROM public.credit_ledger
  WHERE user_id = _user_id AND kind IN ('extra_purchase','extra_spend');

  RETURN jsonb_build_object(
    'premium', premium,
    'dailyAllowance', allowance,
    'dailyUsed', least(used, allowance),
    'dailyLeft', greatest(allowance - used, 0),
    'extraCredits', greatest(extra, 0),
    'creditsLeft', greatest(allowance - used, 0) + greatest(extra, 0)
  );
END;
$$;

-- Spends one or more credits: today's refresh first, purchased extras after.
CREATE OR REPLACE FUNCTION public.spend_connect_credit(_user_id uuid, _amount integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  snap jsonb;
  want integer := greatest(coalesce(_amount, 1), 1);
  from_daily integer;
  from_extra integer;
BEGIN
  IF _user_id IS NULL OR _user_id <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  snap := public.credit_snapshot(_user_id);
  IF (snap->>'creditsLeft')::int < want THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'credits', 'credits', snap);
  END IF;

  from_daily := least(want, (snap->>'dailyLeft')::int);
  from_extra := want - from_daily;

  IF from_daily > 0 THEN
    INSERT INTO public.credit_ledger (user_id, kind, amount)
    VALUES (_user_id, 'daily_spend', from_daily);
  END IF;
  IF from_extra > 0 THEN
    INSERT INTO public.credit_ledger (user_id, kind, amount)
    VALUES (_user_id, 'extra_spend', from_extra);
  END IF;

  RETURN jsonb_build_object('ok', true, 'credits', public.credit_snapshot(_user_id));
END;
$$;

-- Everything the client needs to render plan state and remaining allowances.
CREATE OR REPLACE FUNCTION public.entitlement_snapshot(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  premium boolean := public.is_premium(_user_id);
  today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  images_used integer := 0;
  credits_row record;
  verification_end timestamptz;
  credits_active boolean := false;
BEGIN
  SELECT count(*) INTO images_used
  FROM public.chat_media
  WHERE sender_id = _user_id
    AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = today_ist;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id AND s.plan_id = 'credits' AND s.status = 'active'
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ) INTO credits_active;

  SELECT s.current_period_end INTO verification_end
  FROM public.subscriptions s
  WHERE s.user_id = _user_id AND s.plan_id = 'verification' AND s.status = 'active'
    AND (s.current_period_end IS NULL OR s.current_period_end > now())
  LIMIT 1;

  RETURN jsonb_build_object(
    'plan', CASE WHEN premium THEN 'premium' ELSE 'free' END,
    'premium', premium,
    'creditsPlanActive', credits_active,
    'verificationActive', verification_end IS NOT NULL,
    'verificationExpiresAt', verification_end,
    'credits', public.credit_snapshot(_user_id),
    'images', jsonb_build_object(
      'allowance', CASE WHEN premium THEN 20 ELSE 5 END,
      'used', images_used,
      'left', greatest((CASE WHEN premium THEN 20 ELSE 5 END) - images_used, 0)
    ),
    'calls', public.call_entitlement(_user_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spend_connect_credit(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.entitlement_snapshot(uuid) TO authenticated, service_role;

-- 5. Realtime ----------------------------------------------------------------
ALTER TABLE public.subscriptions REPLICA IDENTITY FULL;
ALTER TABLE public.credit_ledger REPLICA IDENTITY FULL;
ALTER TABLE public.payment_intents REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_ledger;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_intents;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
