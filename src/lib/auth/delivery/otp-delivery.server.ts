/**
 * WhatsApp OTP delivery adapters.
 *
 *   N Connect backend -> OTP service -> delivery adapter -> Evolution Go
 *
 * The adapter is selected by `OTP_DELIVERY_PROVIDER` and all credentials are
 * read from environment variables inside the handler. No credential ever
 * reaches the frontend, and the OTP itself is never returned to a client.
 */

import type { OtpDelivery } from "../otp-core";

/** Development adapter: no external service required, code never leaves the server. */
class DevDelivery implements OtpDelivery {
  readonly id = "dev";
  readonly channel = "whatsapp" as const;

  async send(input: { phone: string; code: string }): Promise<void> {
    // Deliberately never logs the code itself.
    console.info(`[otp] dev delivery: code issued for ${maskPhone(input.phone)}`);
  }
}

/** Evolution Go WhatsApp adapter. Credentials come from the environment only. */
class EvolutionGoDelivery implements OtpDelivery {
  readonly id = "evolution-go";
  readonly channel = "whatsapp" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly instance: string,
  ) {}

  async send(input: { phone: string; code: string; expirySeconds: number }): Promise<void> {
    const minutes = Math.max(1, Math.round(input.expirySeconds / 60));
    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(this.instance)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: this.apiKey },
        body: JSON.stringify({
          number: input.phone.replace(/\D/g, ""),
          text: `Your N Connect verification code is ${input.code}. It expires in ${minutes} minute${
            minutes === 1 ? "" : "s"
          }. Never share this code.`,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Evolution Go delivery failed with status ${response.status}`);
    }
  }
}

function maskPhone(phone: string): string {
  return phone.replace(/.(?=.{3})/g, "*");
}

/** Builds the configured delivery adapter. Call inside a server handler. */
export function createOtpDelivery(): OtpDelivery {
  const provider = (process.env["OTP_DELIVERY_PROVIDER"] ?? "dev").toLowerCase();
  if (provider === "evolution-go" || provider === "evolution_go") {
    const baseUrl = process.env["EVOLUTION_GO_BASE_URL"];
    const apiKey = process.env["EVOLUTION_GO_API_KEY"];
    const instance = process.env["EVOLUTION_GO_INSTANCE"];
    if (!baseUrl || !apiKey || !instance) {
      throw new Error("Evolution Go delivery is selected but its environment is incomplete");
    }
    return new EvolutionGoDelivery(baseUrl, apiKey, instance);
  }
  return new DevDelivery();
}
