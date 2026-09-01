import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isHexColor } from "@/components/dashboard/InitialsAvatar";

/**
 * Self-service reads/writes on the caller's own `users` row — straight to
 * Supabase. RLS ("users_can_view_self"/"users_view_self_by_auth_id",
 * auth_user_id = auth.uid()) already scopes the reads to just the caller's
 * row; the writes go through the same self-scoped RPCs
 * (set_my_avatar_color/set_my_profile_details/set_my_font_scale[_mobile])
 * the old routes called, so the RLS/permission surface is identical either way.
 */

async function currentAuthUserId(): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function fetchMyAvatarColor(): Promise<string | null> {
  const authUid = await currentAuthUserId();
  if (!authUid) return null;
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("users")
    .select("avatar_color")
    .eq("auth_user_id", authUid)
    .maybeSingle();
  if (error) return null;
  const raw = (data as { avatar_color?: unknown } | null)?.avatar_color;
  return typeof raw === "string" && isHexColor(raw) ? raw : null;
}

export async function setMyAvatarColor(color: string | null): Promise<boolean> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("set_my_avatar_color", { p_color: color });
  return !error;
}

export async function setMyProfileDetails(fullName: string, phone: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("set_my_profile_details", {
    p_full_name: fullName,
    p_phone: phone,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function clampScale(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(2, Math.max(0.5, n));
}

export async function fetchMyFontScale(): Promise<{ fontScale: number | null; fontScaleMobile: number | null }> {
  const authUid = await currentAuthUserId();
  if (!authUid) return { fontScale: null, fontScaleMobile: null };
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("users")
    .select("font_scale,font_scale_mobile")
    .eq("auth_user_id", authUid)
    .maybeSingle();
  if (error) {
    // Pre-migration: the mobile column isn't there yet.
    const legacy = await supabase.from("users").select("font_scale").eq("auth_user_id", authUid).maybeSingle();
    return { fontScale: clampScale((legacy.data as { font_scale?: unknown } | null)?.font_scale), fontScaleMobile: null };
  }
  const row = data as { font_scale?: unknown; font_scale_mobile?: unknown } | null;
  return { fontScale: clampScale(row?.font_scale), fontScaleMobile: clampScale(row?.font_scale_mobile) };
}

export async function setMyFontScale(scale: number, device: "desktop" | "mobile"): Promise<boolean> {
  const clamped = clampScale(scale);
  if (clamped == null) return false;
  const supabase = createSupabaseBrowserClient();
  const rpc = device === "mobile" ? "set_my_font_scale_mobile" : "set_my_font_scale";
  const { error } = await supabase.rpc(rpc, { p_scale: clamped });
  return !error;
}
