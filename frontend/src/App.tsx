import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Peliculas from "./pages/Peliculas";
import Watch from "./pages/Watch";
import { AuthProvider } from "./auth/auth";
import RequireSubscription from "./components/RequireSubscription";
import Suscribite from "./pages/Suscribite";
import Ingresar from "./pages/Ingresar";
import Cuenta from "./pages/Cuenta";
import Perfiles from "./pages/Perfiles";
import ContinuarViendo from "./components/ContinuarViendo";
import ProfileChip from "./components/ProfileChip";
import Vivo from "./pages/Vivo";

type Canal = {
  nombre: string;
  logo: string;
  link: string;
};

function Inicio() {
  const [canales, setCanales] = useState<Canal[]>([]);
  const [canalSeleccionado, setCanalSeleccionado] = useState<Canal | null>(null);
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

        <div className="header-actions">
          <ProfileChip />
          <Link to="/cuenta" className="movies-button">
            Mi cuenta
          </Link>
          <Link to="/vivo" className="movies-button">
  🔴 En vivo
</Link>
          <Link to="/peliculas" className="movies-button">
            Películas
          </Link>
        </div>
      </header>

      <main className="main">
        <ContinuarViendo />

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
                    canalSeleccionado?.nombre === canal.nombre ? "selected" : ""
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
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RequireSubscription><Inicio /></RequireSubscription>} />
          <Route path="/peliculas" element={<RequireSubscription><Peliculas /></RequireSubscription>} />
          <Route path="/ver/:type/:tmdbId" element={<RequireSubscription><Watch /></RequireSubscription>} />
          <Route path="/ver/:type/:tmdbId/:season/:episode" element={<RequireSubscription><Watch /></RequireSubscription>} />
          <Route path="/suscribite" element={<Suscribite />} />
          <Route path="/ingresar" element={<Ingresar />} />
          <Route path="/cuenta" element={<Cuenta />} />
          <Route path="/perfiles" element={<RequireSubscription needProfile={false}><Perfiles /></RequireSubscription>} />
          <Route path="/vivo" element={<RequireSubscription><Vivo /></RequireSubscription>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;