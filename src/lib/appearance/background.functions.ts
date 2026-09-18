import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Db = SupabaseClient<any>;

const BUCKET = "appearance-media";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const ownedPath = (userId: string, path: string) => path.startsWith(`${userId}/`);

export const prepareAppearanceBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mime: string; sizeBytes: number }) =>
    z
      .object({
        mime: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
        sizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ext = (data.mime.split("/")[1] ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "jpg";
    const path = `${context.userId}/${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await (context.supabase as Db).storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error("Could not prepare the background upload");
    return { path, token: signed.token };
  });

export const getAppearanceBackgroundUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) =>
    z.object({ path: z.string().trim().min(1).max(400) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!ownedPath(context.userId, data.path)) return { url: null as string | null };
    const { data: signed, error } = await (context.supabase as Db).storage
      .from(BUCKET)
      .createSignedUrl(data.path, 60 * 60);
    return { url: error ? null : (signed?.signedUrl ?? null) };
  });

export const deleteAppearanceBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) =>
    z.object({ path: z.string().trim().min(1).max(400) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!ownedPath(context.userId, data.path)) return { removed: false };
    const { error } = await (context.supabase as Db).storage.from(BUCKET).remove([data.path]);
    return { removed: !error };
  });