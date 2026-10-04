import { useEffect, useState } from "react";

type TipoContenido = "movie" | "tv";

type TMDBItem = {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
};

type TMDBDetail = TMDBItem & {
  runtime?: number;
  episode_run_time?: number[];
  genres?: {
    id: number;
    name: string;
  }[];
  videos?: {
    results: {
      key: string;
      site: string;
      type: string;
    }[];
  };
  credits?: {
    cast: {
      id: number;
      name: string;
    }[];
  };
  seasons?: {
    id: number;
    name: string;
    season_number: number;
    episode_count: number;
  }[];
};

type Episode = {
  id: number;
  episode_number: number;
  name: string;
};

const API_KEY = import.meta.env.VITE_TMDB_API_KEY;

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_URL = "https://image.tmdb.org/t/p/w500";
const BACKDROP_URL = "https://image.tmdb.org/t/p/original";

function Peliculas() {
  const [tipo, setTipo] = useState<TipoContenido>("movie");

  const [items, setItems] = useState<TMDBItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);

  const [seleccionado, setSeleccionado] =
    useState<TMDBDetail | null>(null);

  const [cargandoDetalle, setCargandoDetalle] =
    useState(false);

  const [mostrarTrailer, setMostrarTrailer] =
    useState(false);

  const [mostrarReproductor, setMostrarReproductor] =
    useState(false);

  const [temporadas, setTemporadas] = useState<
    NonNullable<TMDBDetail["seasons"]>
  >([]);

  const [temporada, setTemporada] = useState<number | null>(null);

  const [episodios, setEpisodios] = useState<Episode[]>([]);

  const [episodio, setEpisodio] = useState<number | null>(null);

  const [cargandoEpisodios, setCargandoEpisodios] =
    useState(false);

  const [miLista, setMiLista] = useState<
    { id: number; type: TipoContenido }[]
  >(() => {
    try {
      return JSON.parse(
        localStorage.getItem("rexpelis_mylist") || "[]"
      );
    } catch {
      return [];
    }
  });

  async function tmdb<T>(
    endpoint: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${endpoint}`);

    url.searchParams.set("api_key", API_KEY);
    url.searchParams.set("language", "es-AR");

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Error consultando TMDB");
    }

    return response.json();
  }

  async function cargarContenido(
    tipoContenido: TipoContenido
  ) {
    if (!API_KEY) {
      setError("No se encontró la API Key de TMDB.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const endpoint =
        tipoContenido === "movie"
          ? "/movie/popular"
          : "/tv/popular";

      const data = await tmdb<{ results: TMDBItem[] }>(
        endpoint,
        {
          page: "1",
        }
      );

      setItems(data.results ?? []);
    } catch (error) {
      console.error(error);
      setError("No se pudo conectar con TMDB.");
    } finally {
      setLoading(false);
    }
  }

  async function buscar() {
    if (!busqueda.trim()) {
      cargarContenido(tipo);
      return;
    }

    setBuscando(true);
    setError("");

    try {
      const endpoint =
        tipo === "movie"
          ? "/search/movie"
          : "/search/tv";

      const data = await tmdb<{ results: TMDBItem[] }>(
        endpoint,
        {
          query: busqueda,
          page: "1",
        }
      );

      setItems(data.results ?? []);
    } catch (error) {
      console.error(error);
      setError("No se pudo realizar la búsqueda.");
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    cargarContenido(tipo);
  }, [tipo]);

  function cambiarTipo(
    nuevoTipo: TipoContenido
  ) {
    setTipo(nuevoTipo);
    setBusqueda("");
  }

  async function abrirDetalle(
    id: number,
    tipoContenido: TipoContenido
  ) {
    setCargandoDetalle(true);

    setSeleccionado(null);
    setMostrarTrailer(false);
    setMostrarReproductor(false);

    try {
      const data = await tmdb<TMDBDetail>(
        `/${tipoContenido}/${id}`,
        {
          append_to_response: "videos,credits",
        }
      );

      setSeleccionado(data);
    } catch (error) {
      console.error(error);
      setError("No se pudo cargar el detalle.");
    } finally {
      setCargandoDetalle(false);
    }
  }

  function cerrarDetalle() {
    setSeleccionado(null);
    setMostrarTrailer(false);
    setMostrarReproductor(false);
    setTemporadas([]);
    setEpisodios([]);
    setTemporada(null);
    setEpisodio(null);
  }

  function obtenerTrailer(
    data: TMDBDetail
  ) {
    return (
      data.videos?.results.find(
        (video) =>
          video.site === "YouTube" &&
          video.type === "Trailer"
      ) ||
      data.videos?.results.find(
        (video) => video.site === "YouTube"
      )
    );
  }

  function obtenerDuracion(
    data: TMDBDetail
  ) {
    if (data.runtime) {
      const horas = Math.floor(data.runtime / 60);
      const minutos = data.runtime % 60;

      if (horas > 0) {
        return `${horas}h ${minutos}min`;
      }

      return `${minutos}min`;
    }

    if (data.episode_run_time?.[0]) {
      return `${data.episode_run_time[0]}min/ep`;
    }

    return "";
  }

  function estaEnMiLista(
    id: number,
    type: TipoContenido
  ) {
    return miLista.some(
      (item) =>
        item.id === id &&
        item.type === type
    );
  }

  function alternarMiLista() {
    if (!seleccionado) return;

    const existe = estaEnMiLista(
      seleccionado.id,
      tipo
    );

    let nuevaLista;

    if (existe) {
      nuevaLista = miLista.filter(
        (item) =>
          !(
            item.id === seleccionado.id &&
            item.type === tipo
          )
      );
    } else {
      nuevaLista = [
        ...miLista,
        {
          id: seleccionado.id,
          type: tipo,
        },
      ];
    }

    setMiLista(nuevaLista);

    localStorage.setItem(
      "rexpelis_mylist",
      JSON.stringify(nuevaLista)
    );
  }

  async function abrirReproductor() {
    if (!seleccionado) return;

    if (tipo === "movie") {
      setMostrarReproductor(true);
      return;
    }

    try {
      setCargandoEpisodios(true);
      setMostrarReproductor(true);

      const listaTemporadas =
        seleccionado.seasons?.filter(
          (season) =>
            season.season_number >= 0
        ) || [];

      setTemporadas(listaTemporadas);

      if (listaTemporadas.length > 0) {
        const primera =
          listaTemporadas[0].season_number;

        setTemporada(primera);

        await cargarEpisodios(
          seleccionado.id,
          primera
        );
      }
    } catch (error) {
      console.error(error);
    } finally {
      setCargandoEpisodios(false);
    }
  }

  async function cargarEpisodios(
    id: number,
    numeroTemporada: number
  ) {
    setCargandoEpisodios(true);

    try {
      const data = await tmdb<{
        episodes: Episode[];
      }>(
        `/tv/${id}/season/${numeroTemporada}`
      );

      setEpisodios(data.episodes ?? []);

      if (data.episodes?.length) {
        setEpisodio(
          data.episodes[0].episode_number
        );
      } else {
        setEpisodio(null);
      }
    } catch (error) {
      console.error(error);
      setEpisodios([]);
      setEpisodio(null);
    } finally {
      setCargandoEpisodios(false);
    }
  }

  function reproducirEpisodio() {
    if (
      !seleccionado ||
      temporada === null ||
      episodio === null
    ) {
      return;
    }

    setMostrarReproductor(true);
  }

  const trailer =
    seleccionado
      ? obtenerTrailer(seleccionado)
      : null;

  const duracion =
    seleccionado
      ? obtenerDuracion(seleccionado)
      : "";

  const reparto =
    seleccionado?.credits?.cast
      ?.slice(0, 6)
      .map((actor) => actor.name)
      .join(", ");

  const anio =
    seleccionado
      ? (
          seleccionado.release_date ||
          seleccionado.first_air_date ||
          ""
        ).slice(0, 4)
      : "";

  return (
    <div className="peliculas-page">

      <header className="peliculas-header">

        <div>
          <h1>Rex Pelis</h1>

          <p>
            Películas y series
          </p>
        </div>

        <a
          href="/"
          className="volver-button"
        >
          ← RexPlay
        </a>

      </header>

      <main className="peliculas-main">

        <div className="content-tabs">

          <button
            className={
              tipo === "movie"
                ? "active"
                : ""
            }
            onClick={() =>
              cambiarTipo("movie")
            }
          >
            🎬 Películas
          </button>

          <button
            className={
              tipo === "tv"
                ? "active"
                : ""
            }
            onClick={() =>
              cambiarTipo("tv")
            }
          >
            📺 Series
          </button>

        </div>

        <div className="search-box">

          <input
            type="text"
            placeholder={
              tipo === "movie"
                ? "Buscar películas..."
                : "Buscar series..."
            }
            value={busqueda}
            onChange={(event) =>
              setBusqueda(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                buscar();
              }
            }}
          />

          <button onClick={buscar}>
            {buscando
              ? "Buscando..."
              : "Buscar"}
          </button>

        </div>

        {loading && (
          <div className="loading">
            Cargando contenido...
          </div>
        )}

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        {!loading &&
          !error && (
            <section>

              <h2>
                {busqueda
                  ? `Resultados para "${busqueda}"`
                  : tipo === "movie"
                    ? "Películas populares"
                    : "Series populares"}
              </h2>

              <div className="movie-grid">

                {items.map((item) => {

                  const titulo =
                    item.title ||
                    item.name ||
                    "Sin título";

                  const fecha =
                    item.release_date ||
                    item.first_air_date ||
                    "";

                  return (
                    <article
                      className="movie-card"
                      key={item.id}
                      onClick={() =>
                        abrirDetalle(
                          item.id,
                          tipo
                        )
                      }
                    >

                      {item.poster_path ? (
                        <img
                          src={`${IMAGE_URL}${item.poster_path}`}
                          alt={titulo}
                        />
                      ) : (
                        <div className="no-poster">
                          Sin imagen
                        </div>
                      )}

                      <div className="movie-info">

                        <h3>
                          {titulo}
                        </h3>

                        <div className="movie-meta">

                          <span>
                            ⭐{" "}
                            {item.vote_average.toFixed(
                              1
                            )}
                          </span>

                          {fecha && (
                            <span>
                              {fecha.slice(0, 4)}
                            </span>
                          )}

                        </div>

                      </div>

                    </article>
                  );
                })}

              </div>

            </section>
          )}

      </main>

      {/* =========================
          CARGANDO DETALLE
      ========================= */}

      {cargandoDetalle && (
        <div className="detail-overlay">
          <div className="detail-loading">
            Cargando...
          </div>
        </div>
      )}

      {/* =========================
          DETALLE
      ========================= */}

      {seleccionado && (
        <div
          className="detail-overlay"
          onClick={cerrarDetalle}
        >

          <div
            className="detail-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            <button
              className="detail-close"
              onClick={cerrarDetalle}
            >
              ✕
            </button>

            <div className="detail-backdrop-container">

              {seleccionado.backdrop_path ? (
                <img
                  src={`${BACKDROP_URL}${seleccionado.backdrop_path}`}
                  className="detail-backdrop"
                  alt=""
                />
              ) : (
                <div className="detail-backdrop-placeholder" />
              )}

              <div className="detail-gradient" />

            </div>

            <div className="detail-content">

              <h2>
                {seleccionado.title ||
                  seleccionado.name}
              </h2>

              <div className="detail-meta">

                {anio && (
                  <span>{anio}</span>
                )}

                {duracion && (
                  <span>
                    · {duracion}
                  </span>
                )}

                {seleccionado.vote_average > 0 && (
                  <span className="rating">
                    ★{" "}
                    {seleccionado.vote_average.toFixed(
                      1
                    )}
                  </span>
                )}

              </div>

              {seleccionado.genres &&
                seleccionado.genres.length > 0 && (
                  <div className="genre-list">

                    {seleccionado.genres.map(
                      (genre) => (
                        <span
                          key={genre.id}
                          className="genre-chip"
                        >
                          {genre.name}
                        </span>
                      )
                    )}

                  </div>
                )}

              <div className="detail-buttons">

                <button
                  className="trailer-button"
                  disabled={!trailer}
                  onClick={() =>
                    setMostrarTrailer(true)
                  }
                >
                  ▶{" "}
                  {trailer
                    ? "Ver trailer"
                    : "Sin trailer"}
                </button>

                <button
                  className="watch-button"
                  onClick={abrirReproductor}
                >
                  ▶ Ver ahora
                </button>

                <button
                  className="list-button"
                  onClick={alternarMiLista}
                >
                  {estaEnMiLista(
                    seleccionado.id,
                    tipo
                  )
                    ? "✓ En mi lista"
                    : "+ Mi Lista"}
                </button>

              </div>

              <p className="detail-overview">
                {seleccionado.overview ||
                  "Sin sinopsis disponible."}
              </p>

              {reparto && (
                <p className="detail-cast">
                  <strong>Reparto:</strong>{" "}
                  {reparto}
                </p>
              )}

            </div>

          </div>

        </div>
      )}

      {/* =========================
          TRAILER
      ========================= */}

      {mostrarTrailer &&
        trailer && (
          <div className="fullscreen-player">

            <button
              className="fullscreen-close"
              onClick={() =>
                setMostrarTrailer(false)
              }
            >
              ✕
            </button>

            <div className="trailer-frame">

              <iframe
                src={`https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0`}
                title="Trailer"
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />

            </div>

          </div>
        )}

      {/* =========================
          REPRODUCTOR
      ========================= */}

      {mostrarReproductor && (
        <div className="fullscreen-player">

          <button
            className="fullscreen-close"
            onClick={() =>
              setMostrarReproductor(false)
            }
          >
            ✕
          </button>

          {/* PELÍCULA */}

          {tipo === "movie" && (
            <iframe
  src={`https://embos.top/movie/?mid=${seleccionado?.id}`}
  className="watch-frame"
  title="Película"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowFullScreen
/>
          )}

          {/* SERIE */}

          {tipo === "tv" && (
            <div className="series-player">

              <h2>
                Seleccionar episodio
              </h2>

              <div className="episode-selectors">

                <select
                  value={
                    temporada ?? ""
                  }
                  onChange={async (event) => {

                    const nuevaTemporada =
                      Number(
                        event.target.value
                      );

                    setTemporada(
                      nuevaTemporada
                    );

                    if (
                      seleccionado
                    ) {
                      await cargarEpisodios(
                        seleccionado.id,
                        nuevaTemporada
                      );
                    }
                  }}
                >

                  {temporadas.map(
                    (season) => (
                      <option
                        key={season.id}
                        value={
                          season.season_number
                        }
                      >
                        {season.name}
                      </option>
                    )
                  )}

                </select>

                <select
                  value={
                    episodio ?? ""
                  }
                  onChange={(event) =>
                    setEpisodio(
                      Number(
                        event.target.value
                      )
                    )
                  }
                >

                  {episodios.map(
                    (ep) => (
                      <option
                        key={ep.id}
                        value={
                          ep.episode_number
                        }
                      >
                        Episodio{" "}
                        {ep.episode_number}
                        {ep.name
                          ? ` — ${ep.name}`
                          : ""}
                      </option>
                    )
                  )}

                </select>

              </div>

              {cargandoEpisodios && (
                <p>
                  Cargando episodios...
                </p>
              )}

              <button
                className="watch-button"
                onClick={reproducirEpisodio}
                disabled={
                  temporada === null ||
                  episodio === null
                }
              >
                ▶ Reproducir
              </button>

              {temporada !== null &&
                episodio !== null && (
                  <iframe
  className="watch-frame"
  src={`https://embos.top/tv/?mid=${seleccionado?.id}&s=${temporada}&e=${episodio}`}
  title="Serie"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowFullScreen
/>
                )}

            </div>
          )}

        </div>
      )}

    </div>
  );
}

export default Peliculas;