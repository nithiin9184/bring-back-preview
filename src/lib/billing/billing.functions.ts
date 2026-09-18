/**
 * Subscriptions, Connect Credits and entitlements — server side.
 *
 * The database is the single source of truth: plan status lives in
 * `subscriptions`, every credit movement in `credit_ledger`, every purchase in
 * `payment_intents`. Nothing here trusts a number sent by the client, and no
 * plan is ever activated without a verified payment.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  EXTRA_CREDIT_MIN,
  EXTRA_CREDIT_PRICE,
  PLAN_OPTIONS,
  VERIFICATION_DAYS,
} from "@/lib/entitlements";
import { createProviderOrder, paymentsConfigured } from "./payments.server";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any>;

export type CreditSnapshot = {
  premium: boolean;
  dailyAllowance: number;
  dailyUsed: number;
  dailyLeft: number;
  extraCredits: number;
  creditsLeft: number;
};

export type EntitlementSnapshot = {
  plan: "free" | "premium";
  premium: boolean;
  creditsPlanActive: boolean;
  verificationActive: boolean;
  verificationExpiresAt: string | null;
  credits: CreditSnapshot;
  images: { allowance: number; used: number; left: number };
  calls: {
    premium: boolean;
    blocked: string | null;
    callsLeft: number | null;
    secondsLeftToday: number | null;
    maxCallSeconds: number | null;
    completedToday: number;
    secondsUsedToday: number;
  };
};

/** The whole entitlement state for the signed-in account. */
export const getEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as Db).rpc("entitlement_snapshot", {
      _user_id: userId,
    });
    if (error) throw new Error(error.message);
    return data as unknown as EntitlementSnapshot;
  });

/** Spends Connect Credits. The daily refresh is used first, extras after. */
export const spendCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { amount?: number }) =>
    z.object({ amount: z.number().int().min(1).max(50).default(1) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: result, error } = await (supabase as Db).rpc("spend_connect_credit", {
      _user_id: userId,
      _amount: data.amount,
    });
    if (error) throw new Error(error.message);
    const spend = result as unknown as
      | { ok: true; credits: CreditSnapshot }
      | { ok: false; reason: string; credits?: CreditSnapshot };
    return spend;
  });

type CheckoutResult =
  | {
      ok: true;
      intentId: string;
      amountInr: number;
      provider: "razorpay";
      order: { orderId: string; keyId: string; currency: "INR" };
    }
  | { ok: false; reason: "payment-unavailable" | "provider-error" | "invalid"; intentId?: string };

/** Creates the intent row, then asks the provider for a real order. */
async function openCheckout(
  userId: string,
  intent:
    | { kind: "plan"; planId: "credits" | "verification"; amountInr: number }
    | { kind: "extra_credits"; credits: number; amountInr: number },
): Promise<CheckoutResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;

  const { data: row, error } = await db
    .from("payment_intents")
    .insert({
      user_id: userId,
      kind: intent.kind,
      plan_id: intent.kind === "plan" ? intent.planId : null,
      credits: intent.kind === "extra_credits" ? intent.credits : null,
      amount_inr: intent.amountInr,
      provider: "razorpay",
      status: "created",
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(error?.message ?? "payment intent could not be created");
  const intentId = (row as { id: string }).id;

  if (!paymentsConfigured()) return { ok: false, reason: "payment-unavailable", intentId };

  const order = await createProviderOrder({
    intentId,
    amountInr: intent.amountInr,
    notes: { userId, kind: intent.kind },
  });
  if (!order.ok) return { ok: false, reason: order.reason, intentId };

  await db
    .from("payment_intents")
    .update({ provider_order_id: order.order.orderId, updated_at: new Date().toISOString() })
    .eq("id", intentId);

  return {
    ok: true,
    intentId,
    amountInr: intent.amountInr,
    provider: "razorpay",
    order: { orderId: order.order.orderId, keyId: order.order.keyId, currency: "INR" },
  };
}

/** Starts a real checkout for one of the two purchasable plans. */
export const startPlanCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { planId: "credits" | "verification" }) =>
    z.object({ planId: z.enum(["credits", "verification"]) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    openCheckout(context.userId, {
      kind: "plan",
      planId: data.planId,
      amountInr: PLAN_OPTIONS[data.planId].amount,
    }),
  );

/** Starts a real checkout for extra Connect Credits (₹2 each, minimum 20). */
export const startExtraCreditsCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { count: number }) =>
    z.object({ count: z.number().int().min(EXTRA_CREDIT_MIN).max(5000) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    openCheckout(context.userId, {
      kind: "extra_credits",
      credits: data.count,
      amountInr: data.count * EXTRA_CREDIT_PRICE,
    }),
  );

/** Cancels an active plan. Credits already purchased are kept. */
export const cancelPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { planId?: "credits" | "verification" }) =>
    z.object({ planId: z.enum(["credits", "verification"]).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Db;
    let query = db
      .from("subscriptions")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId)
      .eq("status", "active");
    if (data.planId) query = query.eq("plan_id", data.planId);
    const { error } = await query;
    if (error) throw new Error(error.message);
    const { data: snapshot } = await (context.supabase as Db).rpc("entitlement_snapshot", {
      _user_id: context.userId,
    });
    return { ok: true as const, entitlements: snapshot as unknown as EntitlementSnapshot };
  });

/**
 * Settles a paid intent. Server-only: called from the verified payment webhook,
 * never from the client.
 */
export async function fulfillPaymentIntent(
  intentId: string,
  providerPaymentId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;

  const { data } = await db
    .from("payment_intents")
    .select("id, user_id, kind, plan_id, credits, status")
    .eq("id", intentId)
    .maybeSingle();
  const intent = data as {
    id: string;
    user_id: string;
    kind: "plan" | "extra_credits";
    plan_id: "credits" | "verification" | null;
    credits: number | null;
    status: string;
  } | null;
  if (!intent) return { ok: false, reason: "unknown-intent" };
  if (intent.status === "paid") return { ok: true };

  const now = new Date();
  if (intent.kind === "plan" && intent.plan_id) {
    const end =
      intent.plan_id === "verification"
        ? new Date(now.getTime() + VERIFICATION_DAYS * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.from("subscriptions").upsert(
      {
        user_id: intent.user_id,
        plan_id: intent.plan_id,
        plan: "premium",
        status: "active",
        provider: "razorpay",
        provider_ref: providerPaymentId,
        amount_inr: PLAN_OPTIONS[intent.plan_id].amount,
        current_period_start: now.toISOString(),
        current_period_end: end.toISOString(),
        cancelled_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id,plan_id" },
    );
  } else if (intent.kind === "extra_credits" && intent.credits) {
    await db.from("credit_ledger").insert({
      user_id: intent.user_id,
      kind: "extra_purchase",
      amount: intent.credits,
      reason: "purchase",
      payment_intent_id: intent.id,
    });
  }

  await db
    .from("payment_intents")
    .update({
      status: "paid",
      provider_payment_id: providerPaymentId,
      updated_at: now.toISOString(),
    })
    .eq("id", intent.id);

  return { ok: true };
}
