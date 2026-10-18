import express from "express";
import cors from "cors";
import { getPlayers, type MediaRequest } from "./providers.js";
import { getImdbId } from "./tmdb.js";

// ⚠️ IMPORTANTE: importar los providers ANTES de usar getPlayers
// y en el orden de prioridad que quieres.
import "./providers/cinecalidad.js"; // 1º (solo películas)
import "./providers/playlatin.js";   // 2º
import "./providers/tonplayer.js";   // 3º
import "./providers/embos.js";       // 4º

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/reproductores", async (req, res) => {
  const { type, tmdbId, title, year, season, episode } = req.body ?? {};

  if (
    !["movie", "tv"].includes(type) ||
    !Number.isInteger(Number(tmdbId)) ||
    !title?.trim()
  ) {
    return res.status(400).json({
      error: "Se requieren type, tmdbId y title válidos",
    });
  }

  const media: MediaRequest = {
    type,
    tmdbId: Number(tmdbId),
    title,
    year: year ? Number(year) : undefined,
    season: season ? Number(season) : undefined,
    episode: episode ? Number(episode) : undefined,
  };

  // Enriquecer con imdbId (lo necesita PlayLatin)
  try {
    media.imdbId = await getImdbId(media.type, media.tmdbId);
  } catch (err) {
    console.warn("No se pudo obtener imdbId:", err);
  }

  try {
    const players = await getPlayers(media);

    return res.json({
      encontrado: players.length > 0,
      pelicula: {
        title: media.title,
        tmdbId: media.tmdbId,
        year: media.year ?? null,
      },
      players,
    });
  } catch (error) {
    console.error("Error obteniendo reproductores:", error);
    return res.status(500).json({
      error: "No se pudieron obtener los reproductores",
    });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(3001, () => {
    console.log("Backend activo en http://localhost:3001");
  });
}

export default app;