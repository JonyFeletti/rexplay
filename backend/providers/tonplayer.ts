import { registerProvider, type Player } from "../providers.js";

registerProvider("tonplayer", async (media) => {
  const url = media.type === "movie"
    ? `https://player.tonplayer.space/play/movie/${media.tmdbId}`
    : `https://player.tonplayer.space/play/tv/${media.tmdbId}/${media.season ?? 1}/${media.episode ?? 1}`;

  return [{
    provider: "tonplayer",
    server: "TonPlayer",
    embedUrl: url,
  }];
});