import { registerProvider, type Player } from "../providers";

registerProvider("playlatin", async (media) => {
  if (!media.imdbId) return [];

  const url = `https://playlatinsrc.co/embed/download/${media.imdbId}`;

  return [{
    provider: "playlatin",
    server: "PlayLatin",
    embedUrl: url,
  }];
});