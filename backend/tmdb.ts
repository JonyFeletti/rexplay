export async function getImdbId(
  type: "movie" | "tv",
  tmdbId: number
): Promise<string | undefined> {
  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_API_KEY) return undefined;

  const res = await fetch(
    `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
  );
  if (!res.ok) return undefined;

  const data = (await res.json()) as { imdb_id?: string | null };
  return data.imdb_id || undefined;
}