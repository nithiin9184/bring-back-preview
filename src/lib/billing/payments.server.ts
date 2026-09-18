/**
 * Payment provider interface (Razorpay).
 *
 * Server-only. Credentials are intentionally absent in this environment: every
 * function below reports `configured: false` instead of guessing, so checkout
 * fails cleanly and nothing is ever marked paid without a real payment.
 */

export type ProviderOrder = {
  orderId: string;
  amountInr: number;
  currency: "INR";
  keyId: string;
};

export type OrderResult =
  | { ok: true; order: ProviderOrder }
  | { ok: false; reason: "payment-unavailable" | "provider-error"; message?: string };

/** True only when real Razorpay credentials exist on the server. */
export function paymentsConfigured(): boolean {
  return Boolean(process.env["RAZORPAY_KEY_ID"] && process.env["RAZORPAY_KEY_SECRET"]);
}

/**
 * Creates a real Razorpay order for an existing payment intent. Without
 * credentials this never calls out and never fabricates an order id.
 */
export async function createProviderOrder(input: {
  intentId: string;
  amountInr: number;
  notes: Record<string, string>;
}): Promise<OrderResult> {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) return { ok: false, reason: "payment-unavailable" };

  const auth = btoa(`${keyId}:${keySecret}`);
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
    body: JSON.stringify({
      amount: input.amountInr * 100,
      currency: "INR",
      receipt: input.intentId,
      notes: input.notes,
    }),
  });

  if (!response.ok) {
    return { ok: false, reason: "provider-error", message: await response.text() };
  }
  const order = (await response.json()) as { id: string };
  return {
    ok: true,
    order: { orderId: order.id, amountInr: input.amountInr, currency: "INR", keyId },
  };
}
