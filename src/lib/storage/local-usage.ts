/**
 * Storage usage for the Storage screen.
 *
 * The numbers come from this account's real server data: stored photo sizes,
 * message bodies and the account's own profile/settings records. Nothing is
 * estimated, and an empty account reports no usage.
 */

import { accountStorageBreakdown } from "@/lib/account/account-repository";

export type StorageItem = { label: string; value: number; tone: string };

/** Real usage for the signed-in account, in MB, grouped for the Storage screen. */
export async function accountStorageUsage(): Promise<StorageItem[]> {
  try {
    return await accountStorageBreakdown();
  } catch (error) {
    console.error("storage usage could not be measured", error);
    return [];
  }
}
