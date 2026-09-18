/**
 * Razorpay payment webhook.
 *
 * The only path that can mark a purchase as paid. The signature is verified
 * against RAZORPAY_WEBHOOK_SECRET before anything is read from the body, and
 * the intent is matched by the provider order id recorded at checkout.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { fulfillPaymentIntent } from "@/lib/billing/billing.functions";

type RazorpayEvent = {
  event?: string;
  payload?: {
    payment?: {
      entity?: { id?: string; order_id?: string; notes?: Record<string, string> };
    };
  };
};

export const Route = createFileRoute("/api/public/hooks/payments-razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
        if (!secret) {
          return new Response("Payments are not configured", { status: 503 });
        }

        const body = await request.text();
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const got = Buffer.from(signature);
        const want = Buffer.from(expected);
        if (got.length !== want.length || !timingSafeEqual(got, want)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: RazorpayEvent;
        try {
          event = JSON.parse(body) as RazorpayEvent;
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        if (event.event !== "payment.captured") return new Response("ignored");

        const payment = event.payload?.payment?.entity;
        const orderId = payment?.order_id;
        const paymentId = payment?.id;
        if (!orderId || !paymentId) return new Response("Missing payment", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await (supabaseAdmin as any)
          .from("payment_intents")
          .select("id")
          .eq("provider", "razorpay")
          .eq("provider_order_id", orderId)
          .maybeSingle();
        const intentId = (data as { id: string } | null)?.id;
        if (!intentId) return new Response("Unknown order", { status: 404 });

        const result = await fulfillPaymentIntent(intentId, paymentId);
        return new Response(result.ok ? "ok" : (result.reason ?? "failed"), {
          status: result.ok ? 200 : 400,
        });
      },
    },
  },
});
