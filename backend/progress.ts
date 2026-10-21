import { supabaseAdmin } from "./supabase.js";
import { HttpError } from "./errors.js";

export const COMPLETE_RATIO = 0.92;
export const MIN_SECONDS = 15;

export interface ProgressInput {
  media_type: "movie" | "tv";
  tmdb_id: number;
  season: number;
  episode: number;
  title: string;
  episode_title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  position_seconds: number;
  duration_seconds: number;
  source: "player" | "estimated";
}

const COLUMNS = "media_type, tmdb_id, season, episode, title, episode_title, poster_path, backdrop_path, position_seconds, duration_seconds, source, updated_at";

const present = (r: any) => ({
  ...r,
  remaining_seconds: r.duration_seconds > 0 ? Math.max(0, r.duration_seconds - r.position_seconds) : null,
  ratio: r.duration_seconds > 0 ? Math.min(1, r.position_seconds / r.duration_seconds) : null,
});

export async function saveProgress(profileId: number, p: ProgressInput): Promise<{ saved: boolean; completed: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("watch_progress")
    .select("id")
    .eq("profile_id", profileId)
    .eq("media_type", p.media_type)
    .eq("tmdb_id", p.tmdb_id)
    .maybeSingle();

  if (!existing && p.position_seconds < MIN_SECONDS) return { saved: false, completed: false };

  const completed = p.duration_seconds > 0 && p.position_seconds / p.duration_seconds >= COMPLETE_RATIO;

  const { error } = await supabaseAdmin
    .from("watch_progress")
    .upsert(
      {
        profile_id: profileId,
        media_type: p.media_type,
        tmdb_id: p.tmdb_id,
        season: p.season,
        episode: p.episode,
        title: p.title,
        episode_title: p.episode_title,
        poster_path: p.poster_path,
        backdrop_path: p.backdrop_path,
        position_seconds: p.position_seconds,
        duration_seconds: p.duration_seconds,
        source: p.source,
        completed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,media_type,tmdb_id" }
    );

  if (error) throw new HttpError(500, "No se pudo guardar el progreso.");
  return { saved: true, completed };
}

export async function continueList(profileId: number) {
  const { data, error } = await supabaseAdmin
    .from("watch_progress")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .eq("completed", false)
    .gte("position_seconds", MIN_SECONDS)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw new HttpError(500, "No se pudo cargar 'Continuar viendo'.");
  return (data ?? []).map(present);
}

export async function getProgress(profileId: number, type: string, tmdbId: number) {
  const { data } = await supabaseAdmin
    .from("watch_progress")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .eq("media_type", type)
    .eq("tmdb_id", tmdbId)
    .eq("completed", false)
    .maybeSingle();
  return data ? present(data) : null;
}

export async function removeProgress(profileId: number, type: string, tmdbId: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from("watch_progress")
    .delete()
    .eq("profile_id", profileId)
    .eq("media_type", type)
    .eq("tmdb_id", tmdbId);
  if (error) throw new HttpError(500, "No se pudo eliminar el progreso.");
}