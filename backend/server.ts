import "./env.js"; // ← SIEMPRE EL PRIMERO
import express from "express";
import cors from "cors";
import { getPlayers, type MediaRequest } from "./providers.js";
import { getImdbId } from "./tmdb.js";

// Providers de reproductores (orden de prioridad)
import "./providers/cinecalidad.js";
import "./providers/playlatin.js";
import "./providers/tonplayer.js";
import "./providers/embos.js";

// Rutas de suscripciones, perfiles, progreso y webhook MP
import { registerSubscriptionRoutes, errorHandler } from "./app.js";
import { runMaintenance } from "./billing.js";

const app = express();

// CORS abierto para el frontend (Vercel + localhost)
app.use(cors({
  origin: true,
  credentials: false,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-profile-id"],
  maxAge: 0,  // ← desactiva el caché de preflight
}));

// ⚠️ Parser JSON global, EXCEPTO para el webhook de Mercado Pago
// (el webhook necesita el body crudo para verificar la firma HMAC).
app.use((req, res, next) => {
  if (req.path === "/webhooks/mercadopago") return next();
  express.json({ limit: "1mb" })(req, res, next);
});

// -------------------- RUTAS DE REPRODUCTORES --------------------
// Ya no necesita express.json() inline: el middleware global lo aplica.
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

// -------------------- RUTAS DE SUSCRIPCIONES --------------------
// Aquí se registran: /webhooks/mercadopago, /api/plans, /api/config, /api/me,
// /api/profiles/*, /api/continue, /api/progress/*, /api/subscription/*,
// /api/admin/*.
//
// El webhook de MP tiene su propio express.raw() dentro de app.ts.
registerSubscriptionRoutes(app);

// -------------------- ERRORES --------------------
app.use(errorHandler);

// -------------------- ARRANQUE --------------------
if (process.env.NODE_ENV !== "production") {
  app.listen(3001, () => {
    console.log("Backend activo en http://localhost:3001");
  });

  // Mantenimiento de suscripciones: cada 10 minutos.
  // En Vercel (serverless) no corre: usar un cron externo (cron-job.org, GitHub Actions, etc.)
  // llamando a /api/admin/resync si querés re-sincronizar manualmente.
  const tick = (): void => {
    runMaintenance().catch((e) =>
      console.error("Falló el mantenimiento de suscripciones:", e),
    );
  };
  setTimeout(tick, 5_000);
  setInterval(tick, 10 * 60_000).unref();
}

export default app;