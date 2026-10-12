export type MediaType = "movie" | "tv";

export interface MediaRequest {
  type: MediaType;
  tmdbId: number;
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  imdbId?: string;
}

export interface Player {
  provider: string;   // id interno: "cinecalidad-filemoon"
  server: string;     // nombre para mostrar: "Filemoon"
  embedUrl: string;
}

export type ProviderAdapter = (media: MediaRequest) => Promise<Player[]>;

const providers: {
  name: string;
  moviesOnly?: boolean;
  resolve: ProviderAdapter;
}[] = [];

export function registerProvider(
  name: string,
  resolve: ProviderAdapter,
  moviesOnly = false
) {
  providers.push({ name, resolve, moviesOnly });
}

export async function getPlayers(media: MediaRequest): Promise<Player[]> {
  const players: Player[] = [];

  for (const provider of providers) {
    if (provider.moviesOnly && media.type !== "movie") continue;

    try {
      const results = await provider.resolve(media);
      players.push(...results);
    } catch (error) {
      console.error(`Error en ${provider.name}:`, error);
    }
  }

  // Deduplicar por embedUrl
  return players.filter(
    (p, i, all) => all.findIndex(x => x.embedUrl === p.embedUrl) === i
  );
}