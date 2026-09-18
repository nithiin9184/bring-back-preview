/**
 * Database-backed OTP store and account repository (service role only).
 * These run exclusively inside server-function handlers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewOtpRecord, OtpChannel, OtpRecord, OtpStore } from "./otp-core";
import { allocateUniqueId } from "./unique-id";

type Row = {
  id: string;
  phone_number_normalized: string;
  otp_hash: string;
  attempts: number;
  max_attempts: number;
  resend_count: number;
  channel: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  superseded_at: string | null;
  invalidated_reason: string | null;
};

const COLUMNS =
  "id, phone_number_normalized, otp_hash, attempts, max_attempts, resend_count, channel, created_at, expires_at, consumed_at, superseded_at, invalidated_reason";

function toRecord(row: Row): OtpRecord {
  return {
    id: row.id,
    phone: row.phone_number_normalized,
    otpHash: row.otp_hash,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    resendCount: row.resend_count,
    channel: row.channel as OtpChannel,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
    consumedAt: row.consumed_at ? new Date(row.consumed_at).getTime() : null,
    supersededAt: row.superseded_at ? new Date(row.superseded_at).getTime() : null,
    invalidatedReason: row.invalidated_reason,
  };
}

export function createOtpStore(database: SupabaseClient<any>): OtpStore {
  const table = () => database.from("otp_challenges");

  return {
    async latestForPhone(phone) {
      const { data } = await table()
        .select(COLUMNS)
        .eq("phone_number_normalized", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? toRecord(data as Row) : null;
    },

    async insert(record: NewOtpRecord) {
      const { data, error } = await table()
        .insert({
          phone_number_normalized: record.phone,
          otp_hash: record.otpHash,
          attempts: record.attempts,
          max_attempts: record.maxAttempts,
          resend_count: record.resendCount,
          channel: record.channel,
          created_at: new Date(record.createdAt).toISOString(),
          expires_at: new Date(record.expiresAt).toISOString(),
        })
        .select(COLUMNS)
        .single();
      if (error || !data) throw new Error("Could not store the verification code");
      return toRecord(data as Row);
    },

    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.attempts !== undefined) row["attempts"] = patch.attempts;
      if (patch.consumedAt !== undefined) {
        row["consumed_at"] = patch.consumedAt ? new Date(patch.consumedAt).toISOString() : null;
      }
      if (patch.supersededAt !== undefined) {
        row["superseded_at"] = patch.supersededAt
          ? new Date(patch.supersededAt).toISOString()
          : null;
      }
      if (patch.invalidatedReason !== undefined) {
        row["invalidated_reason"] = patch.invalidatedReason;
      }
      if (Object.keys(row).length === 0) return;
      await table().update(row).eq("id", id);
    },

    async supersedeActive(phone, at) {
      await table()
        .update({ superseded_at: new Date(at).toISOString(), invalidated_reason: "superseded" })
        .eq("phone_number_normalized", phone)
        .is("consumed_at", null)
        .is("superseded_at", null);
    },

    async countCreatedSince(phone, since) {
      const { count } = await table()
        .select("id", { count: "exact", head: true })
        .eq("phone_number_normalized", phone)
        .gte("created_at", new Date(since).toISOString());
      return count ?? 0;
    },
  };
}

export type Account = {
  id: string;
  uniqueId: string;
  username: string | null;
  name: string;
  profileCompleted: boolean;
  authStatus: string;
};

export type AccountRepository = {
  findByPhone(phone: string): Promise<Account | null>;
  createForPhone(phone: string, createAuthUser: () => Promise<string>): Promise<Account>;
};

const ACCOUNT_COLUMNS = "id, unique_id, username, name, profile_completed, auth_status";

function toAccount(row: any): Account {
  return {
    id: row.id,
    uniqueId: row.unique_id,
    username: row.username ?? null,
    name: row.name ?? "",
    profileCompleted: Boolean(row.profile_completed),
    authStatus: row.auth_status ?? "verified",
  };
}

export function createAccountRepository(database: SupabaseClient<any>): AccountRepository {
  return {
    async findByPhone(phone) {
      const { data } = await database
        .from("profiles")
        .select(ACCOUNT_COLUMNS)
        .eq("phone_number_normalized", phone)
        .maybeSingle();
      return data ? toAccount(data) : null;
    },

    /**
     * Creates exactly one account per normalised phone number, with a permanent
     * Unique ID allocated against the database UNIQUE constraint.
     */
    async createForPhone(phone, createAuthUser) {
      const existing = await this.findByPhone(phone);
      if (existing) return existing;

      const userId = await createAuthUser();
      let created: Account | null = null;

      await allocateUniqueId(async (candidate) => {
        const { data, error } = await database
          .from("profiles")
          .insert({
            id: userId,
            phone: phone,
            phone_number_normalized: phone,
            unique_id: candidate,
            auth_status: "verified",
            profile_completed: false,
          })
          .select(ACCOUNT_COLUMNS)
          .single();

        if (!error && data) {
          created = toAccount(data);
          return true;
        }
        // 23505 = unique violation. A phone clash means the account already
        // exists (concurrent verification); a unique_id clash retries.
        if (error && error.code === "23505") {
          if (!String(error.message).includes("unique_id")) {
            const race = await this.findByPhone(phone);
            if (race) {
              created = race;
              return true;
            }
          }
          return false;
        }
        throw new Error("Could not create the account");
      });

      if (!created) throw new Error("Could not create the account");
      return created;
    },
  };
}
