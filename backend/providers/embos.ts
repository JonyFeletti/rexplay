import { registerProvider, type Player } from "../providers.js";

registerProvider("embos", async (media) => {
  const url = media.type === "tv"
    ? `https://embos.top/tv/?mid=${media.tmdbId}&s=${media.season ?? 1}&e=${media.episode ?? 1}`
    : `https://embos.top/movie/?mid=${media.tmdbId}`;

  return [{
    provider: "embos",
    server: "Embos",
    embedUrl: url,
  }];
});