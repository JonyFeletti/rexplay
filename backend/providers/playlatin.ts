import { registerProvider, type Player } from "../providers.js";

registerProvider("playlatin", async (media) => {
  if (!media.imdbId) return [];

  let url: string;

  if (media.type === "movie") {
    url = `https://playlatinsrc.co/custom/movie/${media.imdbId}`;
  } else {
    // Para series necesitas temporada y episodio
    if (!media.season || !media.episode) return [];
    url = `https://playlatinsrc.co/custom/serial/${media.imdbId}/${media.season}/${media.episode}`;
  }

  return [{
    provider: "playlatin",
    server: "PlayLatin",
    embedUrl: url,
  }];
});