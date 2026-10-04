import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Peliculas from "./pages/Peliculas";

type Canal = {
  nombre: string;
  logo: string;
  link: string;
};

function Inicio() {
  const [canales, setCanales] = useState<Canal[]>([]);
  const [canalSeleccionado, setCanalSeleccionado] =
    useState<Canal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function cargarCanales() {
      const { data, error } = await supabase
        .from("canales")
        .select("nombre, logo, link");

      if (error) {
        console.error(error);
        setError("No se pudieron cargar los canales.");
      } else {
        setCanales(data ?? []);
      }

      setLoading(false);
    }

    cargarCanales();
  }, []);

  function seleccionarCanal(canal: Canal) {
    setCanalSeleccionado(canal);

    setTimeout(() => {
      document.getElementById("player")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>RexPlay</h1>
          <p>TV en vivo</p>
        </div>

        <Link to="/peliculas" className="movies-button">
          🎬 Películas
        </Link>
      </header>

      <main className="main">
        <section className="player" id="player">
          {canalSeleccionado ? (
            <iframe
              src={canalSeleccionado.link}
              className="video-iframe"
              title={canalSeleccionado.nombre}
              allow="autoplay; fullscreen; encrypted-media"
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
            />
          ) : (
            <div className="player-placeholder">
              <span>▶</span>
              <p>Seleccioná un canal para comenzar</p>
            </div>
          )}
        </section>

        <section className="channels">
          <h2>Canales</h2>

          {loading && <p>Cargando canales...</p>}

          {error && <p>{error}</p>}

          {!loading && !error && (
            <div className="channel-grid">
              {canales.map((canal) => (
                <button
                  className={`channel-card ${
                    canalSeleccionado?.nombre === canal.nombre
                      ? "selected"
                      : ""
                  }`}
                  key={canal.nombre}
                  onClick={() => seleccionarCanal(canal)}
                >
                  <img src={canal.logo} alt={canal.nombre} />
                  <h3>{canal.nombre}</h3>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/peliculas" element={<Peliculas />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;