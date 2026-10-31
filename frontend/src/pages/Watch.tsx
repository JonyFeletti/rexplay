import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import EpisodesDrawer from "../components/EpisodesDrawer";
import { api, type ContinueItem } from "../lib/api";
import { useWatchProgress, type WatchMeta } from "../lib/useWatchProgress";
import type { Episode } from "../types/episode";

type TipoContenido = "movie" | "tv";

type PlayerSource = {
  provider: string;
  server: string;
  embedUrl: string;
};

type TMDBDetail = {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  genres?: { id: number; name: string }[];
  seasons?: {
    id: number;
    name: string;
    season_number: number;
    episode_count: number;
  }[];
};

const API_KEY = import.meta.env.VITE_TMDB_API_KEY;
const BASE_URL = "https://api.themoviedb.org/3";

export default function Watch() {
  const { type, tmdbId, season, episode } = useParams<{
    type: string;
    tmdbId: string;
    season?: string;
    episode?: string;
  }>();
  const navigate = useNavigate();

  const tipo = (type === "tv" ? "tv" : "movie") as TipoContenido;
  const id = Number(tmdbId);
  const seasonNum = season ? Number(season) : null;
  const episodeNum = episode ? Number(episode) : null;

  const [detalle, setDetalle] = useState<TMDBDetail | null>(null);
  const [episodios, setEpisodios] = useState<Episode[]>([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(true);
  const [error, setError] = useState("");

  const [reproductores, setReproductores] = useState<PlayerSource[]>([]);
  const [reproductorActual, setReproductorActual] = useState(0);
  const [cargandoReproductores, setCargandoReproductores] = useState(false);
  const [errorReproductores, setErrorReproductores] = useState("");
  const [menuServidoresAbierto, setMenuServidoresAbierto] = useState(false);

  const [drawerAbierto, setDrawerAbierto] = useState(false);
  const [idle, setIdle] = useState(false);

  const [inicioSegundos, setInicioSegundos] = useState(0);
  const playerRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);

  // 1. Cargar detalle de TMDB
  useEffect(() => {
    if (!API_KEY || !id) {
      setError("Parámetros inválidos.");
      setCargandoDetalle(false);
      return;
    }
    setCargandoDetalle(true);
    setError("");
    const url = new URL(`${BASE_URL}/${tipo}/${id}`);
    url.searchParams.set("api_key", API_KEY);
    url.searchParams.set("language", "es-AR");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("No se pudo cargar el detalle.");
        return r.json();
      })
      .then(setDetalle)
      .catch((e) => setError(e.message))
      .finally(() => setCargandoDetalle(false));
  }, [tipo, id]);

  // 2. Cargar episodios de la temporada actual
  useEffect(() => {
    if (tipo !== "tv" || !id || seasonNum === null) return;
    const url = new URL(`${BASE_URL}/tv/${id}/season/${seasonNum}`);
    url.searchParams.set("api_key", API_KEY!);
    url.searchParams.set("language", "es-AR");
    fetch(url)
      .then((r) => r.json())
      .then((data) => setEpisodios(data.episodes ?? []))
      .catch(() => setEpisodios([]));
  }, [tipo, id, seasonNum]);

  // 3. Obtener el minuto guardado
  useEffect(() => {
    if (!id) return;
    api<{ progress: ContinueItem | null }>(`/api/progress/${tipo}/${id}`)
      .then((d) => {
        if (d.progress) {
          if (
            tipo === "movie" ||
            (d.progress.season === seasonNum && d.progress.episode === episodeNum)
          ) {
            setInicioSegundos(d.progress.position_seconds);
          }
        }
      })
      .catch(() => undefined);
  }, [tipo, id, seasonNum, episodeNum]);

  // 4. Cargar reproductores
  useEffect(() => {
    if (!detalle) return;
    setCargandoReproductores(true);
    setErrorReproductores("");
    setReproductores([]);
    setReproductorActual(0);
    setMenuServidoresAbierto(false);

    const title = detalle.title || detalle.name || "";
    const year = (detalle.release_date || detalle.first_air_date || "").slice(0, 4);

    fetch("/api/reproductores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: tipo,
        tmdbId: detalle.id,
        title,
        year: year ? Number(year) : undefined,
        season: tipo === "tv" ? seasonNum : undefined,
        episode: tipo === "tv" ? episodeNum : undefined,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.players?.length) {
          setErrorReproductores("No hay reproductores disponibles.");
        } else {
          setReproductores(data.players);
        }
      })
      .catch(() => setErrorReproductores("Error al consultar el backend."))
      .finally(() => setCargandoReproductores(false));
  }, [detalle, tipo, seasonNum, episodeNum]);

// Idle: ocultar UI a los 3s, pero NO si el mouse está sobre la interfaz
// Idle: ocultar UI a los 3s, pero NO si el mouse está sobre la interfaz
// o si el drawer está abierto
useEffect(() => {
  let timer: number;
  const reset = () => {
    setIdle(false);
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      // No ocultar si el drawer está abierto
      if (drawerAbierto) return;
      // No ocultar si el mouse está sobre la barra superior o el botón de pantalla completa
      if (
        uiRef.current?.matches(":hover") ||
        document.querySelector(".watch-fullscreen-btn:hover")
      ) {
        return;
      }
      setIdle(true);
    }, 3000);
  };
  const onMove = () => reset();
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchstart", onMove);
  window.addEventListener("click", onMove);
  window.addEventListener("keydown", onMove);
  reset();
  return () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("touchstart", onMove);
    window.removeEventListener("click", onMove);
    window.removeEventListener("keydown", onMove);
    clearTimeout(timer);
  };
}, [drawerAbierto]);
// Cerrar el drawer de episodios al hacer click fuera
useEffect(() => {
  if (!drawerAbierto) return;
  const onMouseDown = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".episodes-drawer")) {
      setDrawerAbierto(false);
    }
  };
  document.addEventListener("mousedown", onMouseDown);
  return () => document.removeEventListener("mousedown", onMouseDown);
}, [drawerAbierto]);

  // 6. Guardar progreso
  const episodioActual = episodios.find((ep) => ep.episode_number === episodeNum);
  const metaReproduccion: WatchMeta | null =
    detalle && reproductores.length > 0 && (tipo === "movie" || (seasonNum !== null && episodeNum !== null))
      ? {
          mediaType: tipo,
          tmdbId: detalle.id,
          season: tipo === "tv" ? (seasonNum ?? 0) : 0,
          episode: tipo === "tv" ? (episodeNum ?? 1) : 0,
          title: detalle.title || detalle.name || "Sin título",
          episodeTitle: tipo === "tv" ? (episodioActual?.name ?? null) : null,
          posterPath: detalle.poster_path,
          backdropPath: detalle.backdrop_path,
          durationSeconds: 60 * (
            tipo === "movie"
              ? (detalle.runtime ?? 0)
              : (episodioActual?.runtime ?? detalle.episode_run_time?.[0] ?? 0)
          ),
        }
      : null;

  const playerOrigin = reproductores[reproductorActual]?.embedUrl
    ? new URL(reproductores[reproductorActual].embedUrl).origin
    : "";

  useWatchProgress(metaReproduccion, inicioSegundos, playerRef, playerOrigin);

  // 7. Acciones
  function irAlSiguienteEpisodio() {
    if (tipo !== "tv" || seasonNum === null || episodeNum === null) return;
    const idx = episodios.findIndex((ep) => ep.episode_number === episodeNum);
    if (idx >= 0 && idx < episodios.length - 1) {
      navigate(`/ver/tv/${id}/${seasonNum}/${episodios[idx + 1].episode_number}`);
    }
  }

  function irAEpisodio(nuevaTemporada: number, nuevoEpisodio: number) {
    navigate(`/ver/tv/${id}/${nuevaTemporada}/${nuevoEpisodio}`);
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  const titulo = detalle?.title || detalle?.name || "Cargando...";

  return (
    <div ref={containerRef} className={`watch-page ${idle ? "player-idle" : ""}`}>
      {/* Reproductor a pantalla completa */}
      <div className="watch-player-fullscreen">
        {cargandoDetalle && <p className="watch-loading">Cargando...</p>}
        {error && <p className="watch-error">{error}</p>}
        {cargandoReproductores && <p className="watch-loading">Buscando reproductores...</p>}
        {errorReproductores && <p className="watch-error">{errorReproductores}</p>}

        {!cargandoReproductores && reproductores.length > 0 && (
          <iframe
            ref={playerRef}
            key={reproductores[reproductorActual].embedUrl}
            className="watch-frame"
            src={reproductores[reproductorActual].embedUrl}
            title={titulo}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        )}
      </div>

      {/* Barra superior superpuesta */}
      <div className="watch-top-bar" ref={uiRef}>
        <div className="watch-top-left">
          <Link to="/peliculas" className="watch-back-btn">
            ← Volver
          </Link>
          <h1>{titulo}</h1>
          {tipo === "tv" && seasonNum !== null && episodeNum !== null && (
            <p>
              <span className="watch-chip">T{seasonNum}:E{episodeNum}</span>
              {episodioActual?.name && <span className="watch-ep-name">{episodioActual.name}</span>}
            </p>
          )}
        </div>

        <div className="watch-top-right">
          {tipo === "tv" && (
            <button className="watch-btn-primary" onClick={irAlSiguienteEpisodio}>
              Siguiente episodio →
            </button>
          )}
          {tipo === "tv" && (
            <button
              className="watch-btn-secondary"
              onClick={() => setDrawerAbierto(true)}
              aria-label="Ver episodios"
            >
              ☰ Episodios
            </button>
          )}
          <div className="watch-server-menu">
            <button
              className="watch-btn-secondary"
              onClick={() => setMenuServidoresAbierto(!menuServidoresAbierto)}
              aria-label="Cambiar servidor"
            >
              ⚙ {reproductores[reproductorActual]?.server ?? "Servidor"}
            </button>
            {menuServidoresAbierto && (
              <div className="watch-server-dropdown">
                {reproductores.map((rep, i) => (
                  <button
                    key={rep.embedUrl}
                    className={i === reproductorActual ? "active" : ""}
                    onClick={() => {
                      setReproductorActual(i);
                      setMenuServidoresAbierto(false);
                    }}
                  >
                    {rep.server ?? rep.provider}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Botón de pantalla completa abajo a la derecha */}
      <button className="watch-fullscreen-btn" onClick={toggleFullscreen} aria-label="Pantalla completa">
        ⛶
      </button>

      {/* Drawer de episodios (solo para series) */}
      {tipo === "tv" && detalle?.seasons && (
        <EpisodesDrawer
          open={drawerAbierto}
          onClose={() => setDrawerAbierto(false)}
          seasons={detalle.seasons}
          currentSeason={seasonNum}
          onSeasonChange={(s) => {
            setDrawerAbierto(false);
            irAEpisodio(s, 1);
          }}
          episodes={episodios}
          currentEpisode={episodeNum}
          onEpisodeClick={(ep) => {
            setDrawerAbierto(false);
            if (seasonNum !== null) irAEpisodio(seasonNum, ep);
          }}
        />
      )}
    </div>
  );
}