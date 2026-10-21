import { supabaseAdmin } from "./supabase.js";
import { HttpError } from "./errors.js";
import type { ProfileRow, ProfileView } from "./types.js";

export const MAX_PROFILES = 3;
export const AVATARS = ["rex", "panda", "zorro", "cohete", "fantasma", "pulpo", "unicornio", "robot"] as const;

const view = (p: ProfileRow): ProfileView => ({ id: p.id, name: p.name, avatar: p.avatar });

function cleanName(input: unknown): string {
  const name = (typeof input === "string" ? input : "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 20) throw new HttpError(400, "El nombre del perfil debe tener entre 1 y 20 caracteres.");
  return name;
}
function cleanAvatar(input: unknown): string {
  if (typeof input !== "string" || !(AVATARS as readonly string[]).includes(input)) throw new HttpError(400, "Elegí un avatar de la lista.");
  return input;
}

export async function createDefaultProfile(userId: string, fullName: string): Promise<number> {
  const first = fullName.trim().split(/\s+/)[0]?.replace(/[<>]/g, "").slice(0, 20) || "Perfil";
  const { data, error } = await supabaseAdmin
    .from("sub_profiles")
    .insert({ user_id: userId, name: first, avatar: "rex" })
    .select("id")
    .single();
  if (error) throw new HttpError(500, "No se pudo crear el perfil inicial.");
  return data.id;
}

export async function listProfiles(userId: string, userName = "Perfil"): Promise<ProfileView[]> {
  const { data, error } = await supabaseAdmin
    .from("sub_profiles")
    .select("id, user_id, name, avatar, created_at")
    .eq("user_id", userId)
    .order("id");
  if (error) throw new HttpError(500, "No se pudieron cargar los perfiles.");
  if (!data || data.length === 0) {
    await createDefaultProfile(userId, userName);
    return listProfiles(userId, userName);
  }
  return data.map(view);
}

async function owned(userId: string, profileId: number): Promise<ProfileRow> {
  const { data, error } = await supabaseAdmin
    .from("sub_profiles")
    .select("*")
    .eq("id", profileId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new HttpError(404, "No encontramos ese perfil.");
  return data;
}

async function nameTaken(userId: string, name: string, exceptId = 0): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sub_profiles")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", name)
    .neq("id", exceptId);
  return !!data && data.length > 0;
}

export async function createProfile(userId: string, nameIn: unknown, avatarIn: unknown): Promise<ProfileView> {
  const name = cleanName(nameIn);
  const avatar = cleanAvatar(avatarIn);

  const { count } = await supabaseAdmin
    .from("sub_profiles")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) >= MAX_PROFILES) {
    throw new HttpError(409, `Podés tener hasta ${MAX_PROFILES} perfiles por cuenta.`);
  }
  if (await nameTaken(userId, name)) throw new HttpError(409, "Ya tenés un perfil con ese nombre.");

  const { data, error } = await supabaseAdmin
    .from("sub_profiles")
    .insert({ user_id: userId, name, avatar })
    .select("id, name, avatar")
    .single();
  if (error || !data) throw new HttpError(500, "No se pudo crear el perfil.");
  return { id: data.id, name: data.name, avatar: data.avatar };
}

export async function updateProfile(userId: string, profileId: number, patch: { name?: unknown; avatar?: unknown }): Promise<ProfileView> {
  const current = await owned(userId, profileId);
  const name = patch.name === undefined ? current.name : cleanName(patch.name);
  const avatar = patch.avatar === undefined ? current.avatar : cleanAvatar(patch.avatar);
  if (await nameTaken(userId, name, profileId)) throw new HttpError(409, "Ya tenés un perfil con ese nombre.");

  const { error } = await supabaseAdmin
    .from("sub_profiles")
    .update({ name, avatar })
    .eq("id", profileId)
    .eq("user_id", userId);
  if (error) throw new HttpError(500, "No se pudo actualizar el perfil.");
  return { id: profileId, name, avatar };
}

export async function deleteProfile(userId: string, profileId: number): Promise<void> {
  await owned(userId, profileId);
  const { count } = await supabaseAdmin
    .from("sub_profiles")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) <= 1) throw new HttpError(409, "Tu cuenta necesita al menos un perfil.");

  const { error } = await supabaseAdmin
    .from("sub_profiles")
    .delete()
    .eq("id", profileId)
    .eq("user_id", userId);
  if (error) throw new HttpError(500, "No se pudo eliminar el perfil.");
}