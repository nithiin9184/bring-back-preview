/**
 * Client-side access to the subscription / credit backend.
 *
 * The screens never keep plan state or credit balances of their own: they read
 * this snapshot, and every purchase, spend or cancellation goes through the
 * server. With no backend reachable (or signed out) reads resolve to null and
 * the app falls back to the Free plan, storing nothing on the device.
 */

import { getBackend } from "@/lib/calls/backend";
import {
  cancelPlan,
  getEntitlements,
  spendCredits,
  startExtraCreditsCheckout,
  startPlanCheckout,
  type EntitlementSnapshot,
} from "./billing.functions";
import type { PlanId } from "@/lib/entitlements";

export type { EntitlementSnapshot };

export type Checkout =
  | {
      ok: true;
      intentId: string;
      amountInr: number;
      provider: "razorpay";
      order: { orderId: string; keyId: string; currency: "INR" };
    }
  | { ok: false; reason: "payment-unavailable" | "provider-error" | "invalid"; intentId?: string };

/** True when a signed-in session exists to act on. */
async function signedIn(): Promise<boolean> {
  const supabase = getBackend();
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

/** The server's entitlement snapshot, or null when there is nothing to read. */
export async function loadEntitlements(): Promise<EntitlementSnapshot | null> {
  if (!(await signedIn())) return null;
  try {
    return await getEntitlements();
  } catch (error) {
    console.error("entitlements could not be loaded", error);
    return null;
  }
}

/** Spends credits server-side. Returns the fresh snapshot when it succeeded. */
export async function spendConnectCredits(
  amount = 1,
): Promise<{ ok: boolean; reason?: string; credits?: EntitlementSnapshot["credits"] }> {
  if (!(await signedIn())) return { ok: false, reason: "signed-out" };
  try {
    return await spendCredits({ data: { amount } });
  } catch (error) {
    console.error("credit could not be spent", error);
    return { ok: false, reason: "error" };
  }
}

/** Opens a real checkout for one of the two plans. */
export async function purchasePlan(planId: PlanId): Promise<Checkout> {
  if (!(await signedIn())) return { ok: false, reason: "invalid" };
  try {
    return (await startPlanCheckout({ data: { planId } })) as Checkout;
  } catch (error) {
    console.error("plan checkout failed", error);
    return { ok: false, reason: "provider-error" };
  }
}

/** Opens a real checkout for extra Connect Credits. */
export async function purchaseExtraCredits(count: number): Promise<Checkout> {
  if (!(await signedIn())) return { ok: false, reason: "invalid" };
  try {
    return (await startExtraCreditsCheckout({ data: { count } })) as Checkout;
  } catch (error) {
    console.error("extra credit checkout failed", error);
    return { ok: false, reason: "provider-error" };
  }
}

/** Cancels the active plan(s) server-side. */
export async function cancelSubscription(
  planId?: PlanId,
): Promise<EntitlementSnapshot | null> {
  if (!(await signedIn())) return null;
  try {
    const result = await cancelPlan({ data: planId ? { planId } : {} });
    return result.entitlements ?? null;
  } catch (error) {
    console.error("plan could not be cancelled", error);
    return null;
  }
}

/** Live updates whenever this account's plan or credit rows change. */
export function subscribeEntitlements(userId: string, onChange: () => void): () => void {
  const supabase = getBackend();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`entitlements-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "credit_ledger", filter: `user_id=eq.${userId}` },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
